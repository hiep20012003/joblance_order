import {
    ConflictError,
    ErrorCode,
    IFile,
    INotificationDocument,
    IOffer,
    IOrderDocument,
    IOrderEvent,
    IOrderRequirement,
    IReviewMessageQueue,
    MessageQueueType,
    NotFoundError,
    OfferStatus,
    OrderEventType,
    OrderStatus,
    ROUTING_KEYS,
    runInTransaction,
    UploadFileError,
    uploadMultipleCloudinary, ValidationError
} from '@hiep20012003/joblance-shared';
import {OrderModel} from '@orders/database/models/order.model';
import {
    OfferCancelDTO,
    OrderCreateDTO,
    OrderDeliveryDTO,
    OrderQueryDTO,
    OrderRequirementSubmitDTO
} from '@orders/schemas/order.schema';
import {AppLogger} from '@orders/utils/logger';
import {PipelineStage} from 'mongoose';
import {generateInvoiceId, generateRequirementFileId, sendNotification} from '@orders/utils/helper';
import {v4 as uuidv4} from 'uuid';
import {database} from '@orders/database/connection';
import {paymentsService} from '@orders/services/payments.service';
import {config} from '@orders/config';
import {OfferModel} from '@orders/database/models/offer.model';
import {OfferCreateDTO} from '@orders/schemas/offer.schema';

export class OrdersService {
    async createOffer(payload: OfferCreateDTO): Promise<IOffer> {
        const orderId = uuidv4();
        const data: IOffer = {
            orderId,
            ...payload
        };

        const offer = await OfferModel.create(data);
        return offer.toJSON();
    }

    async createOrderDirect(payload: OrderCreateDTO): Promise<{ order: IOrderDocument, clientSecret: string }> {
        const {
            expectedDeliveryDays,
            gigId,
            buyerId,
            sellerId,
            gigTitle,
            gigDescription,
            buyerUsername,
            buyerEmail,
            buyerPicture,
            sellerUsername,
            sellerEmail,
            sellerPicture,
            gigCoverImage,
            quantity,
            requirements
        } = payload;

        const costDetails = await paymentsService.calculateOrderCost(gigId, buyerId, quantity);

        const dateOrdered = new Date().toISOString();

        // const now = new Date();
        // const expectedDeliveryDate = new Date(now.getTime() + expectedDeliveryDays * 24 * 60 * 60 * 1000).toISOString();

        const invoiceId = generateInvoiceId();

        const orderId = payload.orderId ?? uuidv4();
        const orderDocument: IOrderDocument = {
            _id: orderId,
            gigId,
            buyerId,
            sellerId,
            gigTitle,
            gigDescription,
            buyerUsername,
            buyerEmail,
            buyerPicture,
            sellerUsername,
            sellerEmail,
            sellerPicture,
            gigCoverImage,
            quantity,

            invoiceId,
            serviceFee: costDetails.serviceFee,
            totalAmount: costDetails.totalAmount,
            status: OrderStatus.PENDING,
            dateOrdered,
            expectedDeliveryDays,
            deliveredWork: [],
            requestExtendedDeliveries: [],
            events: [],
            price: costDetails.price,
            currency: costDetails.currency,
            isCustomOffer: false,
            maxRevision: payload?.maxRevision ?? null,
            requirements: requirements.map((requirement) => ({...requirement, answerText: null, answered: false}))
        };

        return runInTransaction(await database.getConnection(), async (session) => {
            const order = await OrderModel.create([orderDocument], {session});

            await sendNotification(MessageQueueType.ORDER_CREATED, ROUTING_KEYS.ORDERS.ORDER_CREATED, {
                // email
                buyerEmail: order[0].buyerEmail,
                sellerEmail: order[0].sellerEmail,
                orderId,
                sellerUsername: order[0].sellerUsername.toLowerCase(),
                buyerUsername: order[0].buyerUsername.toLowerCase(),
                title: order[0].gigTitle,
                description: order[0].gigDescription,
                expectedDeliveryDate: order[0].expectedDeliveryDate,
                quantity: order[0].quantity,
                price: order[0].price,
                serviceFee: order[0].serviceFee,
                totalAmount: order[0].totalAmount,
                orderUrl: `${config.CLIENT_URL}/orders/${orderId}/activities`,

                //
                gigId: order[0].gigId,

            });

            const payment = await paymentsService.createPayment(orderId, buyerId, buyerEmail, session);

            return {order: order[0].toObject() as IOrderDocument, clientSecret: payment?.clientSecret as string};
        });
    }

    async createOrderFromOffer(orderId: string): Promise<IOrderDocument> {

        const data = await OfferModel.findOne({
            orderId: orderId,
        }).lean();

        if (!data || data.status !== OfferStatus.PENDING) {
            throw new ConflictError({clientMessage: 'Offer error'});
        }

        const costDetails = await paymentsService.calculateOrderCost(data.gigId, data.buyerId as string, data.price, data.quantity);


        const {
            expectedDeliveryDays,
            gigId,
            buyerId,
            sellerId,
            gigTitle,
            gigDescription,
            buyerUsername,
            buyerEmail,
            buyerPicture,
            sellerUsername,
            sellerEmail,
            sellerPicture,
            gigCoverImage,
            quantity
        } = data as Required<IOffer>;

        const dateOrdered = new Date().toISOString();

        const now = new Date();
        const expectedDeliveryDate = new Date(now.getTime() + expectedDeliveryDays * 24 * 60 * 60 * 1000).toISOString();

        const invoiceId = generateInvoiceId();

        const event: IOrderEvent = {
            timestamp: new Date().toISOString(),
            type: OrderEventType.ORDER_PLACED
        };

        const orderDocument: IOrderDocument = {
            _id: orderId,
            gigId,
            buyerId,
            sellerId,
            gigTitle,
            gigDescription,
            buyerUsername,
            buyerEmail,
            buyerPicture,
            sellerUsername,
            sellerEmail,
            sellerPicture,
            gigCoverImage,
            quantity,

            invoiceId,
            serviceFee: costDetails.serviceFee,
            totalAmount: costDetails.totalAmount,
            status: OrderStatus.PENDING,
            dateOrdered,
            expectedDeliveryDate,
            deliveredWork: [],
            requestExtendedDeliveries: [],
            events: [event],
            price: costDetails.price,
            currency: costDetails.currency,
            maxRevision: null,
            isCustomOffer: true
        };

        const order = await OrderModel.create(orderDocument);

        // TODO: ORDER:PUBLISH_MESSAGE:ORDER_CREATED
        const notification: INotificationDocument = {
            _id: uuidv4(),
            recipient: {
                id: order.sellerId,
                role: 'seller',
                username: order.sellerUsername,
                avatar: order.sellerPicture ?? ''
            },
            payload: {
                extra: {
                    orderId: orderId,
                },
                message: 'placed an order for your gig.'
            },
            actor: {
                id: order.buyerId,
                role: 'buyer',
                username: order.buyerUsername,
                avatar: order.buyerPicture ?? ''
            },
            timestamp: new Date().toISOString()
        };

        await sendNotification(MessageQueueType.ORDER_CREATED, ROUTING_KEYS.ORDERS.ORDER_CREATED, {
            notification,

            // email
            buyerEmail: order.buyerEmail,
            sellerEmail: order.sellerEmail,
            orderId,
            sellerUsername: order.sellerUsername.toLowerCase(),
            buyerUsername: order.buyerUsername.toLowerCase(),
            title: order.gigTitle,
            description: order.gigDescription,
            expectedDeliveryDate: order.expectedDeliveryDate,
            quantity: order.quantity,
            price: order.price,
            serviceFee: order.serviceFee,
            totalAmount: order.totalAmount,
            orderUrl: `${config.CLIENT_URL}/orders/${orderId}/activities`,

            // Async task
            // seller
            sellerId: order.sellerId,

            // buyer
            buyerId: order.buyerId,
            purchasedGigs: order.gigId,

            // chat
            // buyerId: order.buyerId,
            // sellerId: order.sellerId,
            // orderId,
            gigId,
            isCustomOffer: true
        });

        return order;
    }

    async submitOrderRequirements(
        orderId: string,
        payload: OrderRequirementSubmitDTO,
        files?: Express.Multer.File[]
    ): Promise<IOrderDocument | null> {
        const order = await OrderModel.findOne({
            _id: orderId,
            status: {
                $in: [OrderStatus.ACTIVE],
            }
        }).lean();

        if (!order) {
            throw new NotFoundError({
                clientMessage: 'Order not found.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {orderId}
            });
        }

        if (order.currentNegotiationId) {
            throw new ConflictError({
                clientMessage: 'A negotiation for this order is already in progress. Please wait until it is resolved.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId},
                error: {
                    refresh: true
                }
            });
        }

        // Validate requirement trước khi upload file
        const dbRequirements = order.requirements as IOrderRequirement[];

        // Lấy các requirement bắt buộc
        const requiredReqs = dbRequirements.filter((r) => r.required);

        // Kiểm tra requirement bắt buộc có missing không (text hoặc file)
        const missingRequired = requiredReqs.filter((req) => {
            const answered = payload.requirements.find(
                (r) =>
                    r.requirementId === req.requirementId &&
                    (r.answerText?.trim() || r.hasFile)
            );
            return !answered;
        });

        if (missingRequired.length > 0) {
            throw new ValidationError({
                clientMessage: `Missing answers for required requirements: ${missingRequired
                    .map((r) => r.requirementId)
                    .join(', ')}`,
                operation: 'orders:validate-requirements',
                errorCode: ErrorCode.VALIDATION_ERROR,
                error: {orderId, missing: missingRequired.map((r) => r.requirementId)}
            });
        }

        // 3️⃣ Kiểm tra số lượng file (chỉ check khi có file trong requirement)
        const requiredWithFile = requiredReqs.filter((r) => {
            const matched = payload.requirements.find(
                (pr) => pr.requirementId === r.requirementId
            );
            return matched?.hasFile === true;
        });

        const totalFilesToUpload = (payload.requirements as IOrderRequirement[]).filter(
            (r) => r.hasFile
        ).length;

        if (requiredWithFile.length > 0 && (!files || files.length < requiredWithFile.length)) {
            throw new ValidationError({
                clientMessage: `Missing uploaded files for required requirements. Expected at least ${requiredWithFile.length}, received ${files?.length ?? 0}.`,
                operation: 'orders:validate-files',
                errorCode: ErrorCode.VALIDATION_ERROR,
                error: {
                    orderId,
                    expectedFile: requiredWithFile.length,
                    receivedFile: files?.length ?? 0
                }
            });
        }

        // 4️⃣ Upload file nếu có (sau khi validate)
        let uploadedFiles: (IFile | { error: string; fileName: string })[] = [];

        if (files && files.length > 0) {
            uploadedFiles = await uploadMultipleCloudinary({
                files,
                folder: 'orders/requirements',
                workerPool: undefined,
                handlePublicId: (index: number) => {
                    return generateRequirementFileId(
                        orderId,
                        (payload.requirements as IOrderRequirement[]).filter((item) => item.hasFile)[index].requirementId
                    );
                },
                resourceType: 'raw',
                downloadable: true
            });

            const hasFailedFile = uploadedFiles.some((file) => 'error' in file);
            if (hasFailedFile) {
                const failedFiles = uploadedFiles.filter((file) => 'error' in file);
                const errorMessages = failedFiles.map((f) => `${f.fileName}: ${f.error}`).join('; ');
                throw new UploadFileError({clientMessage: errorMessages});
            }

            if (uploadedFiles.length < totalFilesToUpload) {
                throw new UploadFileError({
                    clientMessage: `Uploaded ${uploadedFiles.length} files, but expected ${totalFilesToUpload}.`,
                    operation: 'orders:upload-files',
                    errorCode: ErrorCode.UPLOAD_FAILED,
                    context: {orderId}
                });
            }
        }

        // 5️⃣ Chuẩn bị dữ liệu update requirements
        const requirements = payload.requirements.map((requirement) => {
            if (requirement.hasFile) {
                return {
                    requirementId: requirement.requirementId,
                    answerFile: uploadedFiles.find(
                        (file) =>
                            'publicId' in file &&
                            file.publicId?.includes(
                                generateRequirementFileId(orderId, requirement.requirementId)
                            )
                    ) as IFile | undefined,
                    answerText: null,
                    answered: true,
                    hasFile: false,
                    question: requirement.question,
                    required: requirement.required
                };
            }

            return {
                requirementId: requirement.requirementId,
                answerText: requirement.answerText,
                answerFile: null,
                answered: true,
                hasFile: false,
                question: requirement.question,
                required: requirement.required
            };
        });
        const now = new Date();
        const expectedDeliveryDate = new Date(now.getTime() + order.expectedDeliveryDays! * 24 * 60 * 60 * 1000).toISOString();

        const updatedOrder = await OrderModel.findByIdAndUpdate(
            orderId,
            {
                $set: {
                    requirements,
                    status: OrderStatus.IN_PROGRESS,
                    expectedDeliveryDate,
                    dueDate: expectedDeliveryDate
                },
                $push: {
                    events: {
                        $each: [
                            {type: OrderEventType.REQUIREMENTS_SUBMITTED},
                            {type: OrderEventType.ORDER_STARTED}
                        ]
                    }
                }
            },
            {new: true}
        );

        if (updatedOrder) {
            AppLogger.info(`Order updated successfully`, {
                operation: 'orders:update-requirements',
                context: {orderId: updatedOrder._id, updatedKeys: ['requirements']}
            });
        }

        // 7️⃣ Gửi notification
        const notification: INotificationDocument = {
            _id: uuidv4(),
            recipient: {
                id: order.sellerId,
                role: 'seller',
                username: order.sellerUsername,
                avatar: order.sellerPicture ?? ''
            },
            payload: {
                extra: {
                    orderId: orderId,
                },
                message: `submitted requirements for order ${orderId}. You can now start working on the order.`
            },
            actor: {
                id: order.buyerId,
                role: 'buyer',
                username: order.buyerUsername,
                avatar: order.buyerPicture ?? ''
            },
            timestamp: new Date().toISOString()
        };

        await sendNotification(
            MessageQueueType.ORDER_REQUIREMENTS_SUBMITTED,
            ROUTING_KEYS.ORDERS.ORDER_REQUIREMENTS_SUBMITTED,
            {
                notification,
                orderId,
                sellerUsername: order.sellerUsername.toLowerCase(),
                buyerUsername: order.buyerUsername.toLowerCase(),
                orderUrl: `${config.CLIENT_URL}/orders/${orderId}`,

                // Async job
                sellerId: order.sellerId,
                gigId: order.gigId,
                ongoingJobs: 1
            }
        );

        return updatedOrder;
    }

    async deliverOrder(
        orderId: string,
        payload: OrderDeliveryDTO,
        files: Express.Multer.File[]
    ): Promise<IOrderDocument | null> {
        const order = await OrderModel.findOne({
            _id: orderId,
        }).lean();

        if (!order) {
            throw new NotFoundError({
                clientMessage: 'Order not found.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {orderId}
            });
        }

        if (![OrderStatus.IN_PROGRESS].includes(order.status)) {
            throw new ConflictError({
                clientMessage: 'The current order has not started yet. Waiting for the buyer to provide requirements to start the order.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId}
            });
        }

        if (order.currentNegotiationId) {
            throw new ConflictError({
                clientMessage: 'A negotiation for this order is already in progress. Please wait until it is resolved.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId},
                error: {
                    refresh: true
                }
            });
        }

        if (
            order.deliveredWork.length > 0 &&
            order.deliveredWork[order.deliveredWork.length - 1].approved === null
        ) {
            throw new ConflictError({
                clientMessage: 'You have a pending delivery awaiting review. Please wait for approval before proceeding.',
                operation: 'orders:pending-delivery-conflict',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId}
            });
        }

        if (!files || files.length === 0) {
            throw new ValidationError({
                clientMessage: 'At least one file is required for delivery.',
                operation: 'orders:deliver-order',
                errorCode: ErrorCode.VALIDATION_ERROR,
                context: {orderId}
            });
        }

        const uploadedFiles = await uploadMultipleCloudinary({
            files,
            folder: 'joblance/gig-deliveries',
            workerPool: undefined,
            handlePublicId: (index: number) => {
                return `${orderId}-${uuidv4()}-${index}`;
            },
            resourceType: 'raw',
            downloadable: true
        });

        const hasFailedFile = uploadedFiles.some((file) => 'error' in file);
        if (hasFailedFile) {
            const failedFiles = uploadedFiles.filter((file) => 'error' in file);
            const errorMessages = failedFiles.map((f) => `${f.fileName}: ${f.error}`).join('; ');
            throw new UploadFileError({clientMessage: errorMessages});
        }

        const deliveryFiles = uploadedFiles as IFile[];

        const eventTimestamp = new Date().toISOString();

        const event = {
            type: OrderEventType.ORDER_DELIVERED,
            timestamp: eventTimestamp
        };
        const delivery = {
            message: payload.message,
            files: deliveryFiles,
            deliveredAt: eventTimestamp
        };

        const timeRemainingBeforePause =
            (+new Date(order.dueDate!) - Date.now()) / (1000 * 60);

        const updatedOrder = await OrderModel.findByIdAndUpdate(
            orderId,
            {
                $set: {
                    status: OrderStatus.DELIVERED,
                    delivered: true,
                    timeRemainingBeforePause,
                },
                $push: {
                    deliveredWork: delivery,
                    events: event
                }
            },
            {new: true}
        ).lean();

        if (updatedOrder) {
            AppLogger.info(`Order delivered successfully`, {
                operation: 'orders:delivered',
                context: {orderId: order._id, updatedKeys: ['deliveredWork', 'events']}
            });

            // TODO: ORDER:PUBLISH_MESSAGE:ORDER_DELIVERED
            const notification: INotificationDocument = {
                _id: uuidv4(),
                actor: {
                    id: order.sellerId,
                    role: 'seller',
                    username: order.sellerUsername,
                    avatar: order.sellerPicture ?? ''
                },
                payload: {
                    extra: {
                        orderId: orderId,
                    },
                    message: `delivered your order.`
                },
                recipient: {
                    id: order.buyerId,
                    role: 'buyer',
                    username: order.buyerUsername,
                    avatar: order.buyerPicture ?? ''
                },
                timestamp: new Date().toISOString()
            };

            await sendNotification(MessageQueueType.ORDER_DELIVERED, ROUTING_KEYS.ORDERS.ORDER_DELIVERED, {
                // Notification
                notification,

                // email
                buyerEmail: order.buyerEmail,
                sellerEmail: order.sellerEmail,
                orderId,
                sellerUsername: order.sellerUsername.toLowerCase(),
                buyerUsername: order.buyerUsername.toLowerCase(),
                title: order.gigTitle,
                orderUrl: `${config.CLIENT_URL}/orders/${orderId}`,

                //
                gigId: order.gigId,

            });
        }

        return updatedOrder;
    }

    async approveOrderDelivery(orderId: string): Promise<IOrderDocument | null> {
        const order = await OrderModel.findOne({
            _id: orderId,
            status: {$in: [OrderStatus.DELIVERED]},
        }).lean();

        if (!order) {
            throw new NotFoundError({
                clientMessage: 'Order not found.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {orderId},
            });
        }

        if (order.currentNegotiationId) {
            throw new ConflictError({
                clientMessage: 'A negotiation for this order is already in progress. Please wait until it is resolved.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId},
                error: {
                    refresh: true
                }
            });
        }

        // Check delivery existence
        if (!order.deliveredWork.length) {
            throw new ConflictError({
                clientMessage: 'No delivery found to approve.',
                operation: 'orders:no-delivery-found',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId},
            });
        }

        const lastDelivery = order.deliveredWork[order.deliveredWork.length - 1];

        // Check approval status
        if (lastDelivery.approved !== null) {
            throw new ConflictError({
                clientMessage: 'The latest delivery has already been reviewed.',
                operation: 'orders:delivery-already-reviewed',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId},
            });
        }

        const approvedAt = (new Date()).toISOString();

        const updatedOrder = await OrderModel.findByIdAndUpdate(
            orderId,
            {
                $set: {
                    approvedAt: approvedAt,
                    status: OrderStatus.COMPLETED,
                    'deliveredWork.$[last].approved': true,
                    'deliveredWork.$[last].approvedAt': approvedAt,
                },
            },
            {
                new: true,
                arrayFilters: [{'last._id': lastDelivery._id}],
            }
        ).lean();


        if (updatedOrder) {
            AppLogger.info(`Order approved successfully`, {
                operation: 'orders:approved',
                context: {orderId: order._id, updatedKeys: ['status']}
            });

            // TODO: ORDER:PUBLISH_MESSAGE:ORDER_APPROVED
            const notification: INotificationDocument = {
                _id: uuidv4(),
                recipient: {
                    id: order.sellerId,
                    role: 'seller',
                    username: order.sellerUsername,
                    avatar: order.sellerPicture ?? ''
                },
                payload: {
                    extra: {
                        orderId: orderId,
                    },
                    message: `approved your delivery.`
                },
                actor: {
                    id: order.buyerId,
                    role: 'buyer',
                    username: order.buyerUsername,
                    avatar: order.buyerPicture ?? ''
                },
                timestamp: new Date().toISOString()
            };

            await sendNotification(MessageQueueType.ORDER_APPROVED, ROUTING_KEYS.ORDERS.ORDER_APPROVED, {
                // Notification
                notification,

                // email
                buyerEmail: order.buyerEmail,
                sellerEmail: order.sellerEmail,
                orderId,
                sellerUsername: order.sellerUsername.toLowerCase(),
                buyerUsername: order.buyerUsername.toLowerCase(),
                title: order.gigTitle,
                orderUrl: `${config.CLIENT_URL}/orders/${orderId}/activities`,

                // Async task
                // buyer update
                buyerId: order.buyerId,
                purchasedGigs: order.gigId,

                // seller update
                sellerId: order.sellerId,
                ongoingJobs: -1,
                completedJobs: 1,
                totalEarnings: order.price * order.quantity,
                recentDelivery: `${new Date().toISOString()}`,
                //
                gigId: order.gigId,

            });
        }
        return order;
    }

    async requestRevision(orderId: string): Promise<IOrderDocument | null> {
        const order = await OrderModel.findOne({
            _id: orderId,
            status: {$in: [OrderStatus.DELIVERED]},
        }).lean();

        if (!order) {
            throw new NotFoundError({
                clientMessage: 'Order not found.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {orderId},
            });
        }


        if (order.currentNegotiationId) {
            throw new ConflictError({
                clientMessage: 'A negotiation for this order is already in progress. Please wait until it is resolved.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId},
                error: {
                    refresh: true
                }
            });
        }
        // Check delivery existence
        if (!order.deliveredWork.length) {
            throw new ConflictError({
                clientMessage: 'No delivery found to request revision.',
                operation: 'orders:no-delivery-found',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId},
            });
        }

        const lastDelivery = order.deliveredWork[order.deliveredWork.length - 1];

        // Check approval status
        if (lastDelivery.approved !== null) {
            throw new ConflictError({
                clientMessage: 'The latest delivery has already been reviewed.',
                operation: 'orders:delivery-already-reviewed',
                errorCode: ErrorCode.RESOURCE_CONFLICT,
                context: {orderId},
            });
        }

        const dueDate = new Date(Date.now() + order.timeRemainingBeforePause! * 60 * 1000).toISOString();

        // Update order + delivery status
        const updatedOrder = await OrderModel.findByIdAndUpdate(
            orderId,
            {
                $set: {
                    dueDate: dueDate,
                    status: OrderStatus.IN_PROGRESS,
                    timeRemainingBeforePause: null,
                    'deliveredWork.$[last].approved': false, // false = yêu cầu sửa
                    'deliveredWork.$[last].approvedAt': (new Date()).toISOString(),
                },
                $inc: {
                    revisionCount: 1
                }
            },
            {
                new: true,
                arrayFilters: [{'last._id': lastDelivery._id}],
            }
        ).lean();

        if (updatedOrder) {
            AppLogger.info(`Revision requested for order`, {
                operation: 'orders:revision-requested',
                context: {orderId: order._id, updatedKeys: ['status']},
            });

            // Tạo thông báo cho seller
            const notification: INotificationDocument = {
                _id: uuidv4(),
                recipient: {
                    id: order.sellerId,
                    role: 'seller',
                    username: order.sellerUsername,
                    avatar: order.sellerPicture ?? '',
                },
                payload: {
                    extra: {orderId},
                    message: `requested a revision for your delivery.`,
                },
                actor: {
                    id: order.buyerId,
                    role: 'buyer',
                    username: order.buyerUsername,
                    avatar: order.buyerPicture ?? '',
                },
                timestamp: new Date().toISOString(),
            };

            // Gửi message / event tới MQ
            await sendNotification(
                MessageQueueType.ORDER_REVISION_REQUESTED,
                ROUTING_KEYS.ORDERS.ORDER_REVISION_REQUESTED,
                {
                    // Notification
                    notification,

                    // Email content
                    buyerEmail: order.buyerEmail,
                    sellerEmail: order.sellerEmail,
                    orderId,
                    sellerUsername: order.sellerUsername.toLowerCase(),
                    buyerUsername: order.buyerUsername.toLowerCase(),
                    title: order.gigTitle,
                    orderUrl: `${config.CLIENT_URL}/orders/${orderId}`,

                    // // Optional async updates
                    // buyerId: order.buyerId,
                    // sellerId: order.sellerId,
                    gigId: order.gigId,

                }
            );
        }

        return updatedOrder;
    }

    async cancelOrder(orderId: string, actorId: string): Promise<IOrderDocument | null> {
        console.log(`Canceling order ${orderId}`);
        const order = await OrderModel.findOne({
            _id: orderId,
            status: {
                $nin: [OrderStatus.COMPLETED, OrderStatus.CANCELLED]
            }
        }).lean();

        if (!order) {
            throw new NotFoundError({
                clientMessage: 'Order not found.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {orderId}
            });
        }

        if (order.buyerId !== actorId) {
            throw new ConflictError({
                clientMessage: 'You do not have cancel to this order.',
                operation: 'orders:cancel-check',
                errorCode: ErrorCode.FORBIDDEN,
                context: {orderId}
            });
        }

        if (order.status !== OrderStatus.ACTIVE && order.status !== OrderStatus.PENDING) {
            throw new ConflictError({
                clientMessage: 'The order is in processing status and cannot be canceled unilaterally. Please contact the Seller or Customer Support if a dispute needs to be resolved.',
                operation: 'orders:buyer-unilateral-cancel',
                errorCode: ErrorCode.FORBIDDEN,
                context: {orderId}
            });
        }

        return runInTransaction(await database.getConnection(), async (session) => {
            if (order.status === OrderStatus.PENDING)
                await paymentsService.cancelPayment(orderId, session);
            else await paymentsService.refundPayment(orderId, session)
            const updatedOrder = await OrderModel.findByIdAndUpdate(orderId, {
                status: OrderStatus.CANCELLED
            }, {new: true, session}).lean();
            if (updatedOrder) {
                AppLogger.info(`Order updated status successfully`, {
                    operation: 'orders:update',
                    context: {orderId: order._id, updatedKeys: ['status']}
                });

                if (order.status === OrderStatus.ACTIVE) {

                    // TODO: ORDER:PUBLISH_MESSAGE:ORDER_CANCELED
                    const sellerInfo = {
                        id: order.sellerId,
                        role: 'seller',
                        username: order.sellerUsername,
                        avatar: order.sellerPicture ?? ''
                    };
                    const buyerInfo = {
                        id: order.buyerId,
                        role: 'buyer',
                        username: order.buyerUsername,
                        avatar: order.buyerPicture ?? ''
                    };
                    const notification = {
                        _id: uuidv4(),
                        actor: actorId === order.sellerId ? sellerInfo : buyerInfo,
                        recipient: actorId === order.sellerId ? buyerInfo : sellerInfo,
                        payload: {
                            extra: {
                                orderId: orderId,
                            },
                            message: `have cancelled order.`
                        },
                        timestamp: new Date().toISOString()
                    };

                    await sendNotification(MessageQueueType.ORDER_CANCELED, ROUTING_KEYS.ORDERS.ORDER_CANCELED, {
                        // Notification
                        notification,

                        // email
                        buyerEmail: order.buyerEmail,
                        sellerEmail: order.sellerEmail,
                        orderId,
                        sellerUsername: order.sellerUsername.toLowerCase(),
                        buyerUsername: order.buyerUsername.toLowerCase(),
                        title: order.gigTitle,
                        orderUrl: `${config.CLIENT_URL}/orders/${orderId}`,

                        // Async task
                        // buyer update
                        buyerId: order.buyerId,
                        purchasedGigs: order.gigId,

                        // seller update
                        sellerId: order.sellerId,
                        //
                        gigId: order.gigId,

                    });
                }
            }
            return updatedOrder;
        });
    }

    async getOrderById(orderId: string): Promise<IOrderDocument | null> {
        return OrderModel.findById(orderId).populate('negotiation').lean();
    }

    async getOrders(query: OrderQueryDTO): Promise<{ orders: IOrderDocument[]; total: number }> {
        const {
            limit = 10,
            page = 1,
            sortBy = 'dateOrdered',
            order = 'desc',
            search,
            late,
            status,
            priority,
            ...attributes
        } = query;

        const pipeline: PipelineStage[] = [];
        const matchStage: Record<string, unknown> = {};

        // --- 1. MATCH theo attributes cơ bản (sellerId, buyerId, ...)
        Object.assign(matchStage, attributes);

        // --- 2. MATCH theo status
        if (status && status?.length > 0) {
            matchStage.status = {$in: status};
        }

        // --- 3. MATCH theo priority
        if (priority) {
            pipeline.push({
                $lookup: {
                    from: 'negotiations',
                    localField: 'currentNegotiationId',
                    foreignField: '_id',
                    as: 'negotiation',
                },
            });
            pipeline.push({
                $unwind: {
                    path: '$negotiation',
                    preserveNullAndEmptyArrays: true,
                },
            });

            if (attributes.sellerId) {
                matchStage.$or = [
                    {
                        $and: [
                            {currentNegotiationId: {$ne: null}},
                            {'negotiation.requesterId': {$ne: attributes.sellerId}},
                        ],
                    },
                    {status: {$in: [OrderStatus.IN_PROGRESS, OrderStatus.CANCEL_PENDING]}},
                ];
            } else if (attributes.buyerId) {
                matchStage.$or = [
                    {
                        $and: [
                            {currentNegotiationId: {$ne: null}},
                            {'negotiation.requesterId': {$ne: attributes.buyerId}},
                        ],
                    },
                    {status: {$in: [OrderStatus.DELIVERED, OrderStatus.ACTIVE]}},
                ];
            }
        }

        // --- 4. Text search (nên có text index)
        if (search) {
            matchStage.$text = {$search: search};
        }

        // --- 5. Late orders: chỉ tính nếu đang "IN_PROGRESS"
        if (late === true) {
            matchStage.status = 'IN_PROGRESS';
            matchStage.$expr = {
                $lt: [
                    {
                        $dateFromString: {
                            dateString: {$ifNull: ['$dueDate', '']},
                            onError: '$$NOW', // fallback tránh lỗi parse
                        },
                    },
                    '$$NOW',
                ],
            };
        }

        // --- 6. Thêm matchStage gộp
        if (Object.keys(matchStage).length > 0) {
            pipeline.push({$match: matchStage});
        }

        // --- 7. Sort & phân trang
        const skip = (page - 1) * limit;

        pipeline.push({
            $facet: {
                orders: [
                    {$sort: {[sortBy]: order === 'asc' ? 1 : -1}},
                    {$skip: skip},
                    {$limit: limit},
                    {
                        $project: {
                            gigTitle: 1,
                            gigId: 1,
                            gigCoverImage: 1,
                            sellerUsername: 1,
                            sellerId: 1,
                            buyerId: 1,
                            sellerPicture: 1,
                            buyerUsername: 1,
                            buyerPicture: 1,
                            totalAmount: 1,
                            price: 1,
                            quantity: 1,
                            currency: 1,
                            status: 1,
                            dateOrdered: 1,
                            expectedDeliveryDate: 1,
                            currentNegotiationId: 1, // Include negotiation ID
                            negotiation: 1, // Include negotiation details
                        },
                    },
                ],
                totalCount: [{$count: 'total'}],
            },
        });

        // --- 8. Thực thi pipeline
        const [result] = await OrderModel.aggregate<{
            orders: IOrderDocument[];
            totalCount: { total: number }[];
        }>(pipeline).exec();

        return {
            orders: result?.orders ?? [],
            total: result?.totalCount?.[0]?.total ?? 0,
        };
    }


    async updateOrderReview(data: IReviewMessageQueue): Promise<IOrderDocument> {
        const order: IOrderDocument = await OrderModel.findOneAndUpdate(
            {_id: data.orderId},
            {
                // $push:
                //     data.type === MessageQueueType.BUYER_REVIEWED
                //         ? {
                //             events: {type: OrderEventType.BUYER_REVIEW}
                //         }
                //         : {
                //             events: {type: OrderEventType.SELLER_REVIEW}
                //         },
                $set:
                    data.type === MessageQueueType.BUYER_REVIEWED
                        ? {
                            buyerReview: {
                                _id: data.reviewId,
                                rating: data.rating,
                                review: data.review,
                                timestamp: data.createdAt,
                            }
                        }
                        : {
                            sellerReview: {
                                _id: data.reviewId,
                                rating: data.rating,
                                review: data.review,
                                timestamp: data.createdAt,
                            }
                        }
            },
            {new: true}
        ).lean() as IOrderDocument;

        if (order) {
            AppLogger.info(`Order updated successfully`, {
                operation: 'orders:review',
                context: {orderId: order._id, updatedKeys: ['buyerReview', 'sellerReview']}
            });

            // // TODO: ORDER:PUBLISH_MESSAGE:ORDER_REVIEW
            // const sellerInfo = {
            //     id: order.sellerId,
            //     role: 'seller',
            //     username: order.sellerUsername,
            //     avatar: order.sellerPicture ?? ''
            // };
            // const buyerInfo = {
            //     id: order.buyerId,
            //     role: 'buyer',
            //     username: order.buyerUsername,
            //     avatar: order.buyerPicture ?? ''
            // };
            // const notification: INotificationDocument = {
            //     _id: uuidv4(),
            //     actor: data.type === MessageQueueType.BUYER_REVIEWED ? buyerInfo : sellerInfo,
            //     recipient: data.type === MessageQueueType.BUYER_REVIEWED ? sellerInfo : buyerInfo,
            //     payload: {
            //         extra: {
            //             orderId: `${data.orderId}`,
            //         },
            //         message:
            //             data.type === MessageQueueType.BUYER_REVIEWED
            //                 ? `have give one review for your gig.`
            //                 : `have reply for your review.`
            //     },
            //     timestamp: new Date().toISOString()
            // };
            //
            // await sendNotification(MessageQueueType.BUYER_REVIEWED, ROUTING_KEYS.ORDERS.ORDER_CANCELED, {
            //     // Notification
            //     notification,
            //
            //     // seller update
            //     sellerId: order.sellerId,
            // });
        }

        return order;
    }

    async cancelCustomOffer(actor: string, payload: OfferCancelDTO): Promise<IOffer | null> {
        const offer = await OfferModel.findOneAndUpdate(
            {...payload},
            {cancelled: true, accepted: false, cancelledBy: actor},
            {new: true}
        ).lean();

        if (offer) {
            AppLogger.info(`Offer cancel successfully`, {
                operation: 'orders:offer-cancel',
                context: {orderId: offer._id, updatedKeys: ['cancelled', 'cancelledBy']}
            });
        }

        return offer;
    }
}

export const ordersService = new OrdersService();
