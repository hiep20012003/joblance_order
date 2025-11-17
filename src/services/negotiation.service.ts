import {NegotiationCreateDTO, NegotiationUpdateDTO} from '@orders/schemas/negotiation.schema';
import {NegotiationModel} from '@orders/database/models/negotiation.model';
import {
    ConflictError,
    ErrorCode,
    INegotiationDocument,
    INotificationDocument, IOrderDocument,
    MessageQueueType,
    NegotiationStatus,
    NegotiationType,
    NotFoundError,
    OrderStatus,
    ROUTING_KEYS,
    runInTransaction
} from '@hiep20012003/joblance-shared';
import {OrderModel} from '@orders/database/models/order.model';
import {database} from '@orders/database/connection';
import {sendNotification} from '@orders/utils/helper';
import {AppLogger} from '@orders/utils/logger';
import {v4 as uuidv4} from 'uuid';
import {config} from '@orders/config';
import {paymentsService} from '@orders/services/payments.service';

// Thêm hàm tiện ích để tính ngày hết hạn mới
const calculateNewDueDate = (currentDueDate: string | Date, daysToAdd: number): string => {
    const date = new Date(currentDueDate);
    date.setDate(date.getDate() + daysToAdd);
    return date.toISOString();
};

export class NegotiationService {
    //
    async getNegotiationById(negotiationId: string) {
        return await NegotiationModel.findById(negotiationId).lean();
    }

    async createNegotiation(payload: NegotiationCreateDTO) {
        const order = await OrderModel.findById(payload.orderId).lean();

        if (!order) {
            throw new NotFoundError({
                clientMessage: 'Order not found',
                operation: 'orders:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {orderId: payload.orderId}
            });
        }

        // Tối ưu hóa: Không cho đàm phán nếu chưa ACTIVE (ví dụ: vẫn PENDING_REQUIREMENTS, trừ khi là CANCEL)
        if (order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.IN_PROGRESS) {
            // Cho phép CANCEL nếu OrderStatus.PENDING_REQUIREMENTS, nhưng cần logic riêng
            if (payload.type !== NegotiationType.CANCEL_ORDER) {
                throw new ConflictError({
                    clientMessage: `Order status is ${order.status}. Only CANCEL_ORDER is allowed when not active.`,
                    operation: 'orders:invalid-status',
                    errorCode: ErrorCode.RESOURCE_CONFLICT,
                    context: {orderId: payload.orderId, status: order.status}
                });
            }
        }


        if ([OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.DISPUTED].includes(order.status)) {
            throw new ConflictError({
                clientMessage: 'Order cannot be modified because it is completed, cancelled, or disputed',
                operation: 'orders:invalid-status',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId: payload.orderId, status: order.status}
            });
        }

        const existingNegotiationWithOrder = await NegotiationModel.findOne({
            orderId: payload.orderId,
            status: NegotiationStatus.PENDING
        }).lean();

        if (existingNegotiationWithOrder) {
            throw new ConflictError({
                clientMessage: 'A negotiation for this order is already in progress. Please wait until it is resolved.',
                operation: 'negotiations:pending-conflict',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId: payload.orderId},
                error: {
                    refresh: true
                }
            });
        }

        return runInTransaction(await database.getConnection(), async (session) => {
            const negotiationData = {
                ...payload,
            };

            const newNegotiation = await NegotiationModel.create([{...negotiationData}], {session});

            const orderUpdate: Record<string, unknown> = {
                currentNegotiationId: newNegotiation[0]._id,
            };

            // Chỉ đóng băng đồng hồ nếu không phải là OrderStatus.DELIVERED (vì DELIVERED có đồng hồ riêng)
            // hoặc nếu là CANCEL_ORDER.
            if (order.status !== OrderStatus.DELIVERED) {
                // Tính bằng phút
                orderUpdate.timeRemainingBeforePause = (+new Date(order.dueDate!) - Date.now()) / (1000 * 60);

                if (payload.type === NegotiationType.CANCEL_ORDER) {
                    orderUpdate.status = OrderStatus.CANCEL_PENDING;
                }
            }

            const updatedOrder = await OrderModel.findOneAndUpdate({_id: payload.orderId}, {
                $set: orderUpdate
            }, {
                new: true, // Lấy document đã update
                session
            }).lean();

            // ... (Phần notification, messaging queue) ...

            // Giả định logic notification:
            if (updatedOrder) {
                AppLogger.info(`Negotiation create successfully`, {
                    operation: 'orders:create-negotiation',
                    context: {negotiationId: newNegotiation[0]._id, orderId: payload.orderId}
                });

                let messageType: MessageQueueType;
                let notificationMessage: string;
                let routingKey: string;

                switch (payload.type) {
                    case NegotiationType.EXTEND_DELIVERY: {
                        const {newDeliveryDays} = payload.payload as { newDeliveryDays: number };
                        messageType = MessageQueueType.ORDER_EXTENDED_DELIVERY_REQUEST;
                        notificationMessage = `requested ${newDeliveryDays} more delivery days`;
                        routingKey = ROUTING_KEYS.ORDERS.ORDER_EXTENDED_DELIVERY_REQUEST;
                        break;
                    }

                    case NegotiationType.CANCEL_ORDER: {
                        messageType = MessageQueueType.ORDER_CANCELLATION_REQUEST;
                        notificationMessage = `requested to cancel the order.`;
                        routingKey = ROUTING_KEYS.ORDERS.ORDER_CANCELLATION_REQUEST;
                        break;
                    }

                    default: {
                        throw new Error(`Unsupported negotiation type: ${payload.type}`);
                    }
                }


                const actorInfo = {
                    id: payload.requesterId,
                    role: payload.requesterRole,
                    username: payload.requesterRole === 'seller' ? updatedOrder.sellerUsername : updatedOrder.buyerUsername,
                    avatar: payload.requesterRole === 'seller' ? updatedOrder.sellerPicture ?? '' : updatedOrder.buyerPicture ?? ''
                };
                const recipientInfo = payload.requesterRole === 'seller' ? {
                    id: updatedOrder.buyerId,
                    role: 'buyer',
                    username: updatedOrder.buyerUsername,
                    avatar: updatedOrder.buyerPicture ?? ''
                } : {
                    id: updatedOrder.sellerId,
                    role: 'seller',
                    username: updatedOrder.sellerUsername,
                    avatar: updatedOrder.sellerPicture ?? ''
                };

                const notification: INotificationDocument = {
                    _id: uuidv4(),
                    actor: actorInfo,
                    recipient: recipientInfo,
                    payload: {
                        extra: {orderId: updatedOrder._id},
                        message: notificationMessage
                    },
                    timestamp: new Date().toISOString()
                };

                await sendNotification(messageType, routingKey, {
                    notification,
                    buyerEmail: updatedOrder.buyerEmail,
                    sellerEmail: updatedOrder.sellerEmail,
                    orderId: updatedOrder._id as string,
                    sellerUsername: updatedOrder.sellerUsername.toLowerCase(),
                    buyerUsername: updatedOrder.buyerUsername.toLowerCase(),
                    title: updatedOrder.gigTitle,
                    description: updatedOrder.gigDescription,
                    orderUrl: `${config.CLIENT_URL}/orders/${updatedOrder._id as string}`,
                    sellerId: order.sellerId,
                    buyerId: order.buyerId
                });
            }

            return newNegotiation[0].toObject() as INegotiationDocument;
        });
    }

    // =========================================================
    // APPROVE NEGOTIATION
    // =========================================================

    async approveNegotiation(negotiationId: string, _payload: NegotiationUpdateDTO) {
        const negotiation = await NegotiationModel.findById(negotiationId).lean();

        if (!negotiation) {
            throw new NotFoundError({
                clientMessage: 'Negotiation request not found',
                operation: 'negotiations:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {negotiationId: negotiationId}
            });
        }

        if (negotiation.status !== NegotiationStatus.PENDING) {
            throw new ConflictError({
                clientMessage: `Negotiation is already ${negotiation.status}`,
                operation: 'negotiations:invalid-status',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {negotiationId: negotiationId, status: negotiation.status}
            });
        }

        return runInTransaction(await database.getConnection(), async (session) => {
            const order = await OrderModel.findById(negotiation.orderId).lean() as IOrderDocument;

            if (!order) {
                throw new NotFoundError({
                    clientMessage: 'Order not found during approval',
                    operation: 'orders:not-found-approve',
                    errorCode: ErrorCode.NOT_FOUND,
                    context: {orderId: negotiation.orderId}
                });
            }

            const orderUpdate: Record<string, unknown> = {
                currentNegotiationId: null,
            };

            switch (negotiation.type) {
                case NegotiationType.EXTEND_DELIVERY: {
                    const daysToAdd = negotiation.payload.newDeliveryDays;
                    if (daysToAdd) {
                        orderUpdate.dueDate = calculateNewDueDate(order.dueDate!, daysToAdd);
                        orderUpdate.timeRemainingBeforePause = null;
                        AppLogger.info(
                            `Order ${order._id as string} extended by ${daysToAdd} days. New due date: ${orderUpdate.dueDate as string}`,
                            {operation: 'orders:negotiation-approve'});
                    }
                    break;
                }

                case NegotiationType.CANCEL_ORDER: {
                    orderUpdate.status = OrderStatus.CANCELLED;
                    orderUpdate.cancellationDetails = {
                        requestedBy: negotiation.requesterRole,
                        reason: negotiation.payload.reason || 'Approved cancellation request',
                    };
                    orderUpdate.timeRemainingBeforePause = null;
                    // Logic Refund/Xử lý tiền sẽ diễn ra sau khi order bị Cancelled
                    await paymentsService.refundPayment(order._id as string, session);
                    AppLogger.info(`Order ${order._id as string} successfully CANCELLED.`,
                        {operation: 'orders:negotiation-approve'}
                    );
                    break;
                }
                default: {
                    throw new Error(`Unsupported negotiation type: ${negotiation.type}`);
                }
            }

            // 2. Cập nhật Negotiation Status
            const updatedNegotiation = await NegotiationModel.findOneAndUpdate(
                {_id: negotiation._id},
                {$set: {status: NegotiationStatus.ACCEPTED, respondedAt: new Date().toISOString()}},
                {new: true, session}
            ).lean();

            // 3. Cập nhật Order (Áp dụng các thay đổi)
            const updatedOrder = await OrderModel.findOneAndUpdate(
                {_id: order._id},
                {$set: orderUpdate},
                {new: true, session}
            ).lean();

            if (updatedOrder) {

                AppLogger.info('Negotiation approved successfully', {
                    operation: 'negotiations:approve',
                    context: {negotiationId: negotiation._id, orderId: order._id, type: negotiation.type}
                });

                let messageType: MessageQueueType;
                let notificationMessage: string;
                let routingKey: string;

                switch (negotiation.type) {
                    case NegotiationType.EXTEND_DELIVERY: {
                        const {newDeliveryDays} = negotiation.payload as { newDeliveryDays: number };
                        messageType = MessageQueueType.ORDER_EXTENDED_DELIVERY_APPROVED;
                        notificationMessage = `accepted the request to extend delivery by ${newDeliveryDays} days`;
                        routingKey = ROUTING_KEYS.ORDERS.ORDER_EXTENDED_DELIVERY_APPROVED;

                        break;
                    }

                    case NegotiationType.CANCEL_ORDER: {
                        messageType = MessageQueueType.ORDER_CANCELLATION_APPROVED;
                        notificationMessage = `accepted the request to cancel the order`;
                        routingKey = ROUTING_KEYS.ORDERS.ORDER_CANCELLATION_APPROVED;

                        break;
                    }

                    default: {
                        throw new Error(`Unsupported negotiation type: ${negotiation.type as string}`);
                    }
                }


                const recipientInfo = {
                    id: negotiation.requesterId,
                    role: negotiation.requesterRole,
                    username: negotiation.requesterRole === 'seller' ? updatedOrder.sellerUsername : updatedOrder.buyerUsername,
                    avatar: negotiation.requesterRole === 'seller' ? updatedOrder.sellerPicture ?? '' : updatedOrder.buyerPicture ?? ''
                };
                const actorInfo = negotiation.requesterRole === 'seller' ? {
                    id: updatedOrder.buyerId,
                    role: 'buyer',
                    username: updatedOrder.buyerUsername,
                    avatar: updatedOrder.buyerPicture ?? ''
                } : {
                    id: updatedOrder.sellerId,
                    role: 'seller',
                    username: updatedOrder.sellerUsername,
                    avatar: updatedOrder.sellerPicture ?? ''
                };

                const notification: INotificationDocument = {
                    _id: uuidv4(),
                    actor: actorInfo,
                    recipient: recipientInfo,
                    payload: {
                        extra: {orderId: updatedOrder._id},
                        message: notificationMessage
                    },
                    timestamp: new Date().toISOString()
                };

                await sendNotification(messageType, routingKey, {
                    notification,
                    buyerEmail: updatedOrder.buyerEmail,
                    sellerEmail: updatedOrder.sellerEmail,
                    orderId: updatedOrder._id as string,
                    sellerUsername: updatedOrder.sellerUsername.toLowerCase(),
                    buyerUsername: updatedOrder.buyerUsername.toLowerCase(),
                    title: updatedOrder.gigTitle,
                    description: updatedOrder.gigDescription,
                    orderUrl: `${config.CLIENT_URL}/orders/${updatedOrder._id as string}`,
                    sellerId: order.sellerId,
                    buyerId: order.buyerId
                });
            }

            return updatedNegotiation as INegotiationDocument;
        });
    }

    // =========================================================
    // REJECT NEGOTIATION
    // =========================================================

    async rejectNegotiation(negotiationId: string, _payload: NegotiationUpdateDTO) {
        const negotiation = await NegotiationModel.findById(negotiationId).lean();

        if (!negotiation) {
            throw new NotFoundError({
                clientMessage: 'Negotiation request not found',
                operation: 'negotiations:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {negotiationId: negotiationId}
            });
        }

        if (negotiation.status !== NegotiationStatus.PENDING) {
            throw new ConflictError({
                clientMessage: `Negotiation is already ${negotiation.status}`,
                operation: 'negotiations:invalid-status',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {negotiationId: negotiationId, status: negotiation.status}
            });
        }

        return runInTransaction(await database.getConnection(), async (session) => {
            const order = await OrderModel.findById(negotiation.orderId).lean();

            if (!order) {
                throw new NotFoundError({
                    clientMessage: 'Order not found during rejection',
                    operation: 'orders:not-found-reject',
                    errorCode: ErrorCode.NOT_FOUND,
                    context: {orderId: negotiation.orderId}
                });
            }

            const orderUpdate: Record<string, unknown> = {
                currentNegotiationId: null,
            };

            // 1. Logic xử lý sau khi Từ chối
            switch (negotiation.type) {
                case NegotiationType.EXTEND_DELIVERY: {
                    // Nếu bị từ chối, thời gian bị dừng phải được khôi phục/cho chạy lại
                    // (timeRemainingBeforePause đã được lưu khi tạo Negotiation)

                    // Tính lại dueDate mới: Current DateTime + timeRemainingBeforePause
                    if (order.timeRemainingBeforePause !== null && order.timeRemainingBeforePause !== undefined) {
                        const minutes = order.timeRemainingBeforePause;
                        const newDueDate = new Date(Date.now() + minutes * 60 * 1000).toISOString();

                        orderUpdate.dueDate = newDueDate;
                        orderUpdate.timeRemainingBeforePause = null;
                    } else {
                        // Trường hợp không có timeRemainingBeforePause (ví dụ: đã ở DELIVERED)
                        // Chỉ cần xóa currentNegotiationId, Order vẫn giữ trạng thái cũ.
                    }
                    AppLogger.info(`Extend delivery rejected. Due date restored/updated to ${orderUpdate.dueDate as string || 'original date'}`, {operation: 'orders:negotiation-reject'});
                    break;
                }

                case NegotiationType.CANCEL_ORDER: {
                    // Khi yêu cầu hủy bị từ chối, đơn hàng phải quay lại trạng thái trước khi PENDING
                    // Giả định đơn hàng quay lại ACTIVE/DELIVERED và xóa timeRemainingBeforePause
                    orderUpdate.status = order.deliveredWork.length > 0 ? OrderStatus.DELIVERED : OrderStatus.IN_PROGRESS;
                    orderUpdate.timeRemainingBeforePause = null;
                    AppLogger.info(`Cancellation rejected. Order status set back to ${orderUpdate.status as string}`, {operation: 'orders:negotiation-reject'});
                    break;
                }

                case NegotiationType.MODIFY_ORDER: {
                    break;
                }
            }

            // 2. Cập nhật Negotiation Status
            const updatedNegotiation = await NegotiationModel.findOneAndUpdate(
                {_id: negotiation._id},
                {$set: {status: NegotiationStatus.REJECTED, respondedAt: new Date().toISOString()}},
                {new: true, session}
            ).lean();

            // 3. Cập nhật Order (Xóa currentNegotiationId và áp dụng thay đổi)
            const updatedOrder = await OrderModel.findOneAndUpdate(
                {_id: order._id},
                {$set: orderUpdate},
                {new: true, session}
            ).lean();

            if (updatedOrder) {

                AppLogger.info('Negotiation rejected successfully', {
                    operation: 'negotiations:reject',
                    context: {negotiationId: negotiation._id, orderId: order._id, type: negotiation.type}
                });

                let messageType: MessageQueueType;
                let notificationMessage: string;
                let routingKey: string;

                switch (negotiation.type) {
                    case NegotiationType.EXTEND_DELIVERY: {
                        const {newDeliveryDays} = negotiation.payload as { newDeliveryDays: number };
                        messageType = MessageQueueType.ORDER_EXTENDED_DELIVERY_REJECTED;
                        notificationMessage = `rejected the request to extend delivery by ${newDeliveryDays} days`;
                        routingKey = ROUTING_KEYS.ORDERS.ORDER_EXTENDED_DELIVERY_REJECTED;
                        break;
                    }

                    case NegotiationType.CANCEL_ORDER: {
                        messageType = MessageQueueType.ORDER_CANCELLATION_REJECTED;
                        notificationMessage = `rejected the request to cancel the order`;
                        routingKey = ROUTING_KEYS.ORDERS.ORDER_CANCELLATION_REQUEST;
                        break;
                    }

                    default: {
                        throw new Error(`Unsupported negotiation type: ${negotiation.type as string}`);
                    }
                }

                const recipientInfo = {
                    id: negotiation.requesterId,
                    role: negotiation.requesterRole,
                    username: negotiation.requesterRole === 'seller' ? updatedOrder.sellerUsername : updatedOrder.buyerUsername,
                    avatar: negotiation.requesterRole === 'seller' ? updatedOrder.sellerPicture ?? '' : updatedOrder.buyerPicture ?? ''
                };

                const actorInfo = negotiation.requesterRole === 'seller' ? {
                    id: updatedOrder.buyerId,
                    role: 'buyer',
                    username: updatedOrder.buyerUsername,
                    avatar: updatedOrder.buyerPicture ?? ''
                } : {
                    id: updatedOrder.sellerId,
                    role: 'seller',
                    username: updatedOrder.sellerUsername,
                    avatar: updatedOrder.sellerPicture ?? ''
                };

                const notification: INotificationDocument = {
                    _id: uuidv4(),
                    actor: actorInfo,
                    recipient: recipientInfo,
                    payload: {
                        extra: {orderId: updatedOrder._id},
                        message: notificationMessage
                    },
                    timestamp: new Date().toISOString()
                };

                await sendNotification(messageType, routingKey, {
                    notification,
                    buyerEmail: updatedOrder.buyerEmail,
                    sellerEmail: updatedOrder.sellerEmail,
                    orderId: updatedOrder._id as string,
                    sellerUsername: updatedOrder.sellerUsername.toLowerCase(),
                    buyerUsername: updatedOrder.buyerUsername.toLowerCase(),
                    title: updatedOrder.gigTitle,
                    description: updatedOrder.gigDescription,
                    orderUrl: `${config.CLIENT_URL}/orders/${updatedOrder._id as string}`,

                    sellerId: order.sellerId,
                    buyerId: order.buyerId
                });
            }


            return updatedNegotiation as INegotiationDocument;
        });
    }

    async escalateDispute() {

    }
}

export const negotiationService = new NegotiationService();