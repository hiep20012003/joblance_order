import {Request, Response} from 'express';
import {v4 as uuidv4} from 'uuid';
import {faker} from '@faker-js/faker';
import {
    EXCHANGES,
    IBuyerDocument, IGigDocument, IOrderMessageQueue, ISellerDocument, MessageQueueType,
    NegotiationStatus,
    NegotiationType,
    OrderEventType,
    OrderStatus,
    PaymentGateway,
    PaymentStatus, ROUTING_KEYS,
} from '@hiep20012003/joblance-shared';
import mongoose from 'mongoose';
import {NegotiationModel} from '@orders/database/models/negotiation.model';
import {messageQueue, publishChannel} from '@orders/queues/connection';

import {OrderModel} from '../database/models/order.model';
import {PaymentModel} from '../database/models/payment.model';
import {AppLogger} from '../utils/logger';
import {generateInvoiceId} from '../utils/helper';

function biasReview(options: any) {
    const defaultWeights = [5, 10, 15, 30, 40]; // 1★ → 5★
    const weights = options?.weights || defaultWeights;
    const total = weights.reduce((a: number, b: number) => a + b, 0);

    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i + 1; // +1 vì index bắt đầu từ 0 → giá trị từ 1–5
    }
    return 5; // fallback
}

export const seedOrders = async (req: Request, res: Response) => {
    const operation = 'seedOrders';
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const {buyers, sellers, gigs} = req.body as {
            buyers: Required<IBuyerDocument>[];
            sellers: Required<ISellerDocument>[];
            gigs: Required<IGigDocument>[];
        };

        if (!buyers?.length || !sellers?.length || !gigs?.length) {
            return res.status(400).json({message: 'Buyers, sellers, and gigs must be provided'});
        }

        const ordersToInsert: any[] = [];
        const paymentsToInsert: any[] = [];
        const negotiationsToInsert: any[] = [];

        const eventsToPublish: ({ type: MessageQueueType, routingKey: string, payload: any })[] = [];

        // Helper: chọn buyer khác seller, chọn gig của seller
        const pickRandomBuyer = (sellerId: string) => faker.helpers.arrayElement(buyers.filter(b => b._id !== sellerId));
        const pickGigOfSeller = (sellerId: string) => faker.helpers.arrayElement(gigs.filter(g => g.sellerId === sellerId));

        // === LẶP THEO SELLER ĐỂ ĐẢM BẢO ĐÚNG SỐ LƯỢNG ===
        for (const seller of sellers) {
            const completedTarget = seller.completedJobs || 0;
            const ongoingTarget = seller.ongoingJobs || 0;
            const cancelledTarget = seller.cancelledJobs || 0;

            const totalTarget = completedTarget + ongoingTarget + cancelledTarget;

            for (let i = 0; i < totalTarget; i++) {
                const buyer = pickRandomBuyer(seller._id as string);
                const gig = pickGigOfSeller(seller._id as string);
                if (!gig) continue;

                const orderId = uuidv4();
                const dateOrdered = faker.date.recent({days: 30});
                const expectedDeliveryDays = gig.expectedDeliveryDays || faker.number.int({min: 1, max: 14});

                const quantity = faker.number.int({min: 1, max: 3});
                const subtotal = gig.price * quantity;
                const serviceFee = Math.round(subtotal * 0.05);
                const totalAmount = subtotal + serviceFee;

                const order: any = {
                    _id: orderId,
                    invoiceId: generateInvoiceId(),
                    gigId: gig.id, // ← đã sửa
                    buyerId: buyer._id,
                    sellerId: seller._id,
                    gigTitle: gig.title,
                    gigDescription: gig.description,
                    buyerUsername: buyer.username,
                    buyerEmail: buyer.email,
                    buyerPicture: buyer.profilePicture,
                    sellerUsername: seller.username,
                    sellerEmail: seller.email,
                    sellerPicture: seller.profilePicture,
                    gigCoverImage: gig.coverImage,
                    currency: gig.currency || 'USD',
                    quantity,
                    price: gig.price,
                    serviceFee,
                    totalAmount,
                    status: OrderStatus.PENDING,
                    dateOrdered: dateOrdered.toISOString(),
                    expectedDeliveryDays,
                    requirements: gig.requirements?.map((r: any) => ({
                        requirementId: uuidv4(),
                        question: r.question,
                        hasFile: r.hasFile,
                        required: r.required,
                        answered: false,
                        answerText: null,
                        answerFile: null,
                    })) || [],
                    events: [],
                    deliveredWork: [],
                    revisionCount: 0,
                    timeRemainingBeforePause: null,
                    currentNegotiationId: null,
                    cancellationDetails: null,
                    disputeDetails: null,
                };

                const payment: any = {
                    _id: uuidv4(),
                    orderId,
                    gateway: PaymentGateway.STRIPE,
                    amount: totalAmount,
                    currency: order.currency,
                    status: PaymentStatus.PENDING,
                    transactionId: `pi_${faker.string.alphanumeric(24)}`,
                    clientSecret: `cs_test_${faker.string.alphanumeric(32)}`,
                };

                let currentTime = dateOrdered;
                const advanceTime = (hours: number) => {
                    currentTime = new Date(currentTime.getTime() + hours * 60 * 60 * 1000);
                    return currentTime.toISOString();
                };

                let assigned = false;

                // === 1. COMPLETED ===
                if (!assigned && completedTarget > 0 && ordersToInsert.filter(o => o.sellerId === seller._id && o.status === OrderStatus.COMPLETED).length < completedTarget) {
                    payment.status = PaymentStatus.PAID;
                    order.status = OrderStatus.ACTIVE;
                    order.events.push({type: OrderEventType.ORDER_PLACED, timestamp: advanceTime(6)});

                    // Submit requirements
                    order.requirements = order.requirements.map((r: any) => ({
                        ...r,
                        answered: true,
                        answerText: r.hasFile ? null : faker.lorem.sentences(2),
                        answerFile: r.hasFile ? {
                            downloadUrl: faker.internet.url(),
                            secureUrl: faker.internet.url(),
                            fileType: 'application/pdf',
                            fileSize: faker.number.int({min: 100000, max: 2000000}),
                            fileName: `${faker.word.adjective()}.pdf`,
                            publicId: `requirements/${uuidv4()}`,
                        } : null,
                    }));
                    const dueDate = new Date(dateOrdered);
                    dueDate.setDate(dueDate.getDate() + Number(expectedDeliveryDays));
                    order.dueDate = dueDate.toISOString();
                    order.events.push(
                        {type: OrderEventType.REQUIREMENTS_SUBMITTED, timestamp: advanceTime(24)},
                        {type: OrderEventType.ORDER_STARTED, timestamp: advanceTime(1)}
                    );
                    order.status = OrderStatus.IN_PROGRESS;

                    // Deliver + Approve
                    const deliveredAt = advanceTime(48);
                    const approvedAt = advanceTime(24);
                    order.deliveredWork.push({
                        _id: uuidv4(),
                        message: faker.lorem.paragraph(),
                        files: Array.from({length: 2}, () => ({
                            downloadUrl: faker.internet.url(),
                            secureUrl: faker.internet.url(),
                            fileType: 'application/pdf',
                            fileSize: faker.number.int({min: 100000, max: 5000000}),
                            fileName: faker.system.fileName(),
                            publicId: `delivered/${uuidv4()}`,
                        })),
                        approved: true,
                        approvedAt,
                        deliveredAt,
                        metadata: {},
                    });
                    order.events.push(
                        {type: OrderEventType.ORDER_DELIVERED, timestamp: deliveredAt},
                    );
                    order.status = OrderStatus.COMPLETED;
                    order.approvedAt = approvedAt;

                    // === REVIEW: ĐA DẠNG NHƯ THỰC TẾ ===
                    const hasBuyerReview = faker.datatype.boolean({probability: 0.8}); // 80% buyer để lại review
                    const hasSellerReview = faker.datatype.boolean({probability: 0.6}); // 60% seller để lại review

                    if (hasBuyerReview) {
                        const buyerRating = biasReview({
                            weights: [2, 5, 10, 28, 55]
                        });
                        const reviewAt = advanceTime(faker.number.int({min: 12, max: 72})); // 12h - 3 ngày sau approved

                        order.buyerReview = {
                            _id: uuidv4(),
                            rating: buyerRating,
                            review: faker.lorem.sentence(),
                            timestamp: reviewAt,
                        };
                        order.events.push({type: OrderEventType.BUYER_REVIEW, timestamp: reviewAt});

                        // Publish message queue
                        eventsToPublish.push({
                            type: MessageQueueType.BUYER_REVIEWED,
                            routingKey: ROUTING_KEYS.REVIEWS.BUYER_REVIEWED,
                            payload: {
                                rating: buyerRating,
                                gigId: gig.id,
                                targetId: order.sellerId,
                            },
                        });
                    }

                    if (hasSellerReview) {
                        const sellerRating = biasReview({
                            weights: [2, 5, 10, 28, 55]
                        });
                        const sellerReviewAt = advanceTime(faker.number.int({min: 6, max: 48}));

                        order.sellerReview = {
                            _id: uuidv4(),
                            rating: sellerRating,
                            review: faker.lorem.sentence(),
                            timestamp: sellerReviewAt,
                        };
                        order.events.push({type: OrderEventType.SELLER_REVIEW, timestamp: sellerReviewAt});
                    }

                    assigned = true;
                }

                // === 2. ONGOING (IN_PROGRESS / DELIVERED / CANCEL_PENDING) ===
                if (!assigned && ongoingTarget > 0 && ordersToInsert.filter(o => o.sellerId === seller._id && [OrderStatus.IN_PROGRESS, OrderStatus.DELIVERED, OrderStatus.CANCEL_PENDING].includes(o.status as OrderStatus)).length < ongoingTarget) {
                    payment.status = PaymentStatus.PAID;
                    order.status = OrderStatus.ACTIVE;
                    order.events.push({type: OrderEventType.ORDER_PLACED, timestamp: advanceTime(6)});

                    order.requirements = order.requirements.map((r: any) => ({
                        ...r,
                        answered: true,
                        answerText: r.hasFile ? null : faker.lorem.sentences(2),
                        answerFile: r.hasFile ? {
                            downloadUrl: faker.internet.url(),
                            secureUrl: faker.internet.url(),
                            fileType: 'application/pdf',
                            fileSize: faker.number.int({min: 100000, max: 2000000}),
                            fileName: `${faker.word.adjective()}.pdf`,
                            publicId: `requirements/${uuidv4()}`,
                        } : null,
                    }));
                    const dueDate = new Date(dateOrdered);
                    dueDate.setDate(dueDate.getDate() + Number(expectedDeliveryDays));
                    order.dueDate = dueDate.toISOString();
                    order.events.push(
                        {type: OrderEventType.REQUIREMENTS_SUBMITTED, timestamp: advanceTime(24)},
                        {type: OrderEventType.ORDER_STARTED, timestamp: advanceTime(1)}
                    );
                    order.status = OrderStatus.IN_PROGRESS;

                    // 40% có negotiation
                    const hasNegotiation = faker.datatype.boolean({probability: 0.4});
                    if (hasNegotiation) {
                        const negId = uuidv4();
                        const negType = faker.helpers.arrayElement([NegotiationType.EXTEND_DELIVERY, NegotiationType.CANCEL_ORDER]);
                        const negStatus = faker.helpers.arrayElement([
                            NegotiationStatus.PENDING, NegotiationStatus.PENDING, NegotiationStatus.PENDING,
                            NegotiationStatus.PENDING, NegotiationStatus.PENDING, NegotiationStatus.PENDING,
                            NegotiationStatus.PENDING, NegotiationStatus.ACCEPTED, NegotiationStatus.ACCEPTED,
                            NegotiationStatus.REJECTED,
                        ]); // 70% PENDING, 20% ACCEPTED, 10% REJECTED

                        if (negType === NegotiationType.EXTEND_DELIVERY) {
                            const extraDays = faker.number.int({min: 1, max: 7});
                            negotiationsToInsert.push({
                                _id: negId,
                                orderId,
                                type: NegotiationType.EXTEND_DELIVERY,
                                status: negStatus,
                                requesterId: seller._id,
                                requesterRole: 'seller',
                                payload: {newDeliveryDays: extraDays},
                                message: `Need ${extraDays} more days`,
                                respondedAt: negStatus !== NegotiationStatus.PENDING ? advanceTime(24) : null,
                            });

                            if (negStatus === NegotiationStatus.ACCEPTED) {
                                const newDue = new Date(order.dueDate as string);
                                newDue.setDate(newDue.getDate() + extraDays);
                                order.dueDate = newDue.toISOString();
                            } else if (negStatus === NegotiationStatus.PENDING) {
                                order.currentNegotiationId = negId;
                                order.timeRemainingBeforePause = faker.number.int({min: 60, max: 720});
                            }
                        }

                        if (negType === NegotiationType.CANCEL_ORDER) {
                            negotiationsToInsert.push({
                                _id: negId,
                                orderId,
                                type: NegotiationType.CANCEL_ORDER,
                                status: negStatus,
                                requesterId: faker.datatype.boolean() ? buyer._id : seller._id,
                                requesterRole: faker.datatype.boolean() ? 'buyer' : 'seller',
                                payload: {reason: faker.lorem.sentence()},
                                message: 'Request to cancel order',
                                respondedAt: negStatus !== NegotiationStatus.PENDING ? advanceTime(24) : null,
                            });

                            if (negStatus === NegotiationStatus.PENDING) {
                                order.status = OrderStatus.CANCEL_PENDING;
                                order.currentNegotiationId = negId;
                            } else if (negStatus === NegotiationStatus.REJECTED) {
                                order.status = OrderStatus.IN_PROGRESS;
                                order.currentNegotiationId = null;
                                order.timeRemainingBeforePause = null;
                            }
                            // KHÔNG CÓ ACCEPTED Ở ĐÂY → DÀNH CHO BLOCK CANCELLED
                        }
                    }

                    // Nếu không có negotiation đang chờ → có thể DELIVERED
                    if (!order.currentNegotiationId && faker.datatype.boolean({probability: 0.3})) {
                        const deliveredAt = advanceTime(faker.number.int({min: 48, max: 120}));
                        order.deliveredWork.push({
                            _id: uuidv4(),
                            message: faker.lorem.paragraph(),
                            files: Array.from({length: faker.number.int({min: 1, max: 3})}, () => ({
                                downloadUrl: faker.internet.url(),
                                secureUrl: faker.internet.url(),
                                fileType: faker.helpers.arrayElement(['application/pdf', 'image/jpeg', 'image/png', 'application/zip']),
                                fileSize: faker.number.int({min: 100000, max: 8000000}),
                                fileName: faker.system.fileName(),
                                publicId: `delivered/${uuidv4()}`,
                            })),
                            approved: null,
                            approvedAt: null,
                            deliveredAt,
                            metadata: {},
                        });
                        order.events.push({type: OrderEventType.ORDER_DELIVERED, timestamp: deliveredAt});
                        order.status = OrderStatus.DELIVERED;
                    }

                    assigned = true;
                }

                // === 3. CANCELLED (DUY NHẤT ĐƯỢC TẠO Ở ĐÂY) ===
                if (!assigned && cancelledTarget > 0 && ordersToInsert.filter(o => o.sellerId === seller._id && o.status === OrderStatus.CANCELLED).length < cancelledTarget) {
                    payment.status = PaymentStatus.PAID;
                    order.status = OrderStatus.ACTIVE;
                    order.events.push({type: OrderEventType.ORDER_PLACED, timestamp: advanceTime(6)});

                    // Có thể đã submit requirements
                    if (faker.datatype.boolean({probability: 0.7})) {
                        order.requirements = order.requirements.map((r: any) => ({
                            ...r,
                            answered: true,
                            answerText: r.hasFile ? null : faker.lorem.sentences(2),
                            answerFile: r.hasFile ? {
                                downloadUrl: faker.internet.url(),
                                secureUrl: faker.internet.url(),
                                fileType: 'application/pdf',
                                fileSize: faker.number.int({min: 100000, max: 2000000}),
                                fileName: `${faker.word.adjective()}.pdf`,
                                publicId: `requirements/${uuidv4()}`,
                            } : null,
                        }));
                        const dueDate = new Date(dateOrdered);
                        dueDate.setDate(dueDate.getDate() + Number(expectedDeliveryDays));
                        order.dueDate = dueDate.toISOString();
                        order.events.push(
                            {type: OrderEventType.REQUIREMENTS_SUBMITTED, timestamp: advanceTime(24)},
                            {type: OrderEventType.ORDER_STARTED, timestamp: advanceTime(1)}
                        );
                    }

                    const negId = uuidv4();
                    const cancelAt = advanceTime(24);
                    negotiationsToInsert.push({
                        _id: negId,
                        orderId,
                        type: NegotiationType.CANCEL_ORDER,
                        status: NegotiationStatus.ACCEPTED,
                        requesterId: faker.datatype.boolean() ? buyer._id : seller._id,
                        requesterRole: faker.datatype.boolean() ? 'buyer' : 'seller',
                        payload: {reason: faker.lorem.sentence()},
                        message: 'Mutual cancellation',
                        respondedAt: cancelAt,
                    });

                    order.status = OrderStatus.CANCELLED;
                    order.cancellationDetails = {requestedBy: 'BUYER', reason: 'Mutual agreement'};
                    payment.status = PaymentStatus.REFUNDED;

                    assigned = true;
                }

                // === 4. PENDING / ACTIVE (nếu còn dư slot) ===
                if (!assigned) {
                    const progress = faker.number.float({min: 0, max: 0.4});
                    if (progress > 0.15) {
                        payment.status = PaymentStatus.PAID;
                        order.status = OrderStatus.ACTIVE;
                        order.events.push({type: OrderEventType.ORDER_PLACED, timestamp: advanceTime(6)});
                    }
                }

                ordersToInsert.push(order);
                paymentsToInsert.push(payment);
            }
        }

        // Insert all
        const createdOrders = await OrderModel.insertMany(ordersToInsert, {session});
        const createdPayments = await PaymentModel.insertMany(paymentsToInsert, {session});
        if (negotiationsToInsert.length > 0) {
            await NegotiationModel.insertMany(negotiationsToInsert, {session});
        }

        if (eventsToPublish.length > 0) {
            for (const event of eventsToPublish) {
                const exchange = EXCHANGES.REVIEWS.name;

                const message: IOrderMessageQueue = {
                    type: event.type,
                    ...event.payload
                };
                await messageQueue.publish({
                    channelName: publishChannel,
                    exchange,
                    routingKey: event.routingKey,
                    message: JSON.stringify(message)
                });
            }
        }

        await session.commitTransaction();

        AppLogger.info(`Seeded ${createdOrders.length} orders - 100% matched seller stats`, {operation});
        return res.status(201).json({
            message: 'Seeded successfully',
            orders: createdOrders,
            counts: {
                orders: createdOrders.length,
                payments: createdPayments.length,
                negotiations: negotiationsToInsert.length,
            },
        });
    } catch (error: any) {
        await session.abortTransaction();
        AppLogger.error('Seed failed', {operation, error: error.message});
        return res.status(500).json({message: 'Seed failed', error: error.message});
    } finally {
        await session.endSession();
    }
};

export const deleteSeededOrders = async (_req: Request, res: Response) => {
    const operation = 'deleteSeededOrders';
    try {
        const deletedOrdersResult = await OrderModel.deleteMany({
            $or: [
                {buyerEmail: {$regex: /@example\.com$/i}},
                {sellerEmail: {$regex: /@example\.com$/i}},
            ],
        });

        const deletedPaymentsResult = await PaymentModel.deleteMany({
            orderId: {$in: (await OrderModel.find({$or: [{buyerEmail: {$regex: /@example\.com$/i}}, {sellerEmail: {$regex: /@example\.com$/i}}]}).select('_id')).map(o => o._id)},
        });

        const deletedNegotiationsResult = await NegotiationModel.deleteMany({
            orderId: {$in: (await OrderModel.find({$or: [{buyerEmail: {$regex: /@example\.com$/i}}, {sellerEmail: {$regex: /@example\.com$/i}}]}).select('_id')).map(o => o._id)},
        });

        AppLogger.info(`Deleted: ${deletedOrdersResult.deletedCount} orders, ${deletedPaymentsResult.deletedCount} payments, ${deletedNegotiationsResult.deletedCount} negotiations`, {operation});

        return res.status(200).json({
            message: 'Seeded data deleted',
            deleted: {
                orders: deletedOrdersResult.deletedCount,
                payments: deletedPaymentsResult.deletedCount,
                negotiations: deletedNegotiationsResult.deletedCount,
            },
        });
    } catch (error: any) {
        AppLogger.error('Delete failed', {operation, error: error.message});
        return res.status(500).json({message: 'Delete failed', error: error.message});
    }
};