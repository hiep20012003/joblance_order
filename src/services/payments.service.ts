import {
    IBuyerDocument,
    ICostDetails,
    IGigDocument,
    INotificationDocument,
    IOrderDocument,
    IPaymentDocument,
    MessageQueueType,
    NotFoundError,
    OrderEventType,
    OrderStatus,
    PaymentStatus,
    ROUTING_KEYS,
    runInTransaction,
    ServerError,
    SERVICE_FEE_RULES
} from '@hiep20012003/joblance-shared';
import {PaymentModel} from '@orders/database/models/payment.model';
import {stripeClient} from '@orders/utils/payment-gateway';
import {AppLogger} from '@orders/utils/logger';
import mongoose, {ClientSession} from 'mongoose';
import {OrderModel} from '@orders/database/models/order.model';
import {database} from '@orders/database/connection';
import {config} from '@orders/config';
import {PaymentValidateDTO} from '@orders/schemas/payment.schema';
import {sendNotification} from '@orders/utils/helper';
import {externalApiInstance} from '@orders/services/axios.service';
import {v4 as uuidv4} from 'uuid';

// Stripe client

export class PaymentsService {
    async calculateOrderCost(gigId: string, buyerId: string, quantity: number, customPrice?: number): Promise<ICostDetails> {
        let gig: IGigDocument | null = null;
        let price = customPrice;
        let currency = 'USD';

        // 1️⃣ Lấy gig info nếu không có customPrice
        if (!customPrice) {
            const response = await externalApiInstance.get(
                `/api/v1/gigs/${gigId}`
            );
            gig = response.data as IGigDocument;
            price = gig.price;
            currency = gig.currency as string;
        }

        if (!price) throw new Error('Unknown price');

        const buyerResponse = await externalApiInstance.get(
            `/api/v1/buyers/${buyerId}`
        );
        const buyer = buyerResponse.data as IBuyerDocument;

        const amountInCents = Math.round(price);
        let remaining = amountInCents * quantity;
        let fee = 0;

        for (const rule of SERVICE_FEE_RULES) {
            const thresholdInCents = Math.round(rule.threshold);
            const chunk = Math.min(remaining, thresholdInCents);
            fee += Math.round(chunk * rule.rate);
            remaining -= chunk;
            if (remaining <= 0) break;
        }

        const subtotal = amountInCents * quantity;
        const totalBeforeTax = subtotal + fee;

        const countryCode = buyer.country || 'US';

        const calculation = await stripeClient.tax.calculations.create({
            currency,
            customer_details: {
                address: {
                    country: countryCode,
                },
                address_source: 'billing'
            },
            line_items: [
                {
                    amount: subtotal,
                    reference: gigId,
                    tax_behavior: 'exclusive',
                },
                {
                    amount: fee,
                    reference: 'service_fee',
                    tax_behavior: 'exclusive',
                },
            ],
        });

        const totalTax = calculation.tax_amount_exclusive || 0;
        const totalAmount = totalBeforeTax + totalTax;

        // 4️⃣ Trả về kết quả
        return {
            price: amountInCents,
            quantity,
            subtotal,
            serviceFee: fee,
            taxAmount: totalTax,
            totalAmount,
            currency,
            taxBreakdown: calculation.tax_breakdown.map(b => ({
                taxRate: b.tax_rate_details.percentage_decimal, // % VAT/GST
                taxAmount: b.amount, // số tiền thuế
                country: b.tax_rate_details.country, // quốc gia áp thuế
            })),
        } as ICostDetails;
    }

    async createPayment(
        orderId: string,
        userId: string,
        customerEmail: string,
        session: ClientSession | null
    ): Promise<IPaymentDocument | null> {

        const order = await OrderModel.findById(orderId).session(session);
        if (!order) return null;

        // Ngăn duplicate payment
        const existingPayment = await PaymentModel.findOne({orderId, status: PaymentStatus.PENDING}).session(session);
        if (existingPayment) return existingPayment;

        // Lấy hoặc tạo Stripe customer
        let customerId: string;
        const search = await stripeClient.customers.search({query: `email:"${customerEmail}"`});
        if (search.data.length > 0) {
            customerId = search.data[0].id;
        } else {
            const newCustomer = await stripeClient.customers.create({email: customerEmail, metadata: {userId}});
            customerId = newCustomer.id;
        }

        if (!customerId) throw new ServerError();

        // Tạo PaymentIntent
        const paymentIntent = await stripeClient.paymentIntents.create({
            amount: order.totalAmount,
            currency: order.currency.toLowerCase(),
            metadata: {orderId},
            description: `Payment for order ${orderId}`,
            automatic_payment_methods: {enabled: true, allow_redirects: 'never'},
        });

        const payment = await PaymentModel.create([{
            currency: order.currency,
            amount: order.totalAmount,
            orderId,
            status: PaymentStatus.PENDING,
            transactionId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
        }], {session});

        console.debug('Transaction ID: ', payment[0].transactionId);

        return payment[0];
    }

    /**
     * Lấy tất cả payments theo order
     */
    async getPaymentsByOrder(orderId: string, query: Record<string, unknown>): Promise<IPaymentDocument[]> {
        if (query.lastest) {
            return PaymentModel.find({orderId}).sort({createdAt: -1}).limit(1);
        }
        return PaymentModel.find({orderId}).sort({createdAt: 1}).lean();
    }

    async validate(
        payload: PaymentValidateDTO
    ): Promise<{
        valid: boolean;
        status: string;
        data: { order: IOrderDocument | null; clientSecret: string | null };
    }> {
        const {orderId, buyerId, gigId} = payload;

        const payment = await PaymentModel.findOne({orderId}).lean();
        const order = await OrderModel.findById(orderId).lean();
        const response = await externalApiInstance.get(
            `/api/v1/gigs/${gigId}`
        );
        const gig = response.data as IGigDocument;

        if (!payment || !order) {
            return {
                valid: false,
                status: 'NOT_FOUND',
                data: {order: null, clientSecret: null},
            };
        }

        if (String(order.buyerId) !== String(buyerId)) {
            return {
                valid: false,
                status: 'UNAUTHORIZED_BUYER',
                data: {order: null, clientSecret: null},
            };
        }

        if (String(order.gigId) !== String(gigId) || !gig) {
            return {
                valid: false,
                status: 'INVALID_GIG',
                data: {order: null, clientSecret: null},
            };
        }

        const valid =
            payment.status === PaymentStatus.PENDING &&
            order.status === OrderStatus.PENDING;

        if (!valid) {
            return {
                valid: false,
                status: 'INVALID_STATE',
                data: {order: null, clientSecret: null},
            };
        }

        return {
            valid: true,
            status: payment.status,
            data: {
                order,
                clientSecret: payment.clientSecret ?? null,
            },
        };
    }


    /**
     * Lấy payment hiện tại theo order
     */
    async getCurrentPayment(orderId: string): Promise<IPaymentDocument | null> {
        return PaymentModel.findOne({
            orderId,
            status: {$in: [PaymentStatus.PAID, PaymentStatus.PENDING]}
        })
            .sort({createdAt: -1})
            .lean();
    }

    async refundPayment(orderId: string, session: mongoose.ClientSession): Promise<IPaymentDocument[]> {
        const payments = await PaymentModel.find({orderId}).session(session).lean();

        if (payments.length === 0) {
            await session.abortTransaction();
            throw new NotFoundError({
                clientMessage: 'No refundable payments found.',
                context: {orderId},
            });
        }

        await PaymentModel.updateMany(
            {orderId},
            {$set: {status: PaymentStatus.REFUND_PENDING}},
            {session}
        );

        const job = {
            orderId,
            payments: payments.map((p) => ({
                _id: p._id as string,
                transactionId: p.transactionId,
                status: p.status
            })),
            createdAt: new Date().toISOString(),
        };

        await sendNotification(MessageQueueType.ORDER_REFUND_REQUEST, ROUTING_KEYS.ORDERS.ORDER_REFUND_REQUEST, job);

        return payments;
    }

    async cancelPayment(orderId: string, session: mongoose.ClientSession): Promise<IPaymentDocument[]> {
        const payments = await PaymentModel.find({orderId}).session(session).lean();

        if (payments.length === 0) {
            await session.abortTransaction();
            throw new NotFoundError({
                clientMessage: 'No cancelable payments found.',
                context: {orderId},
            });
        }

        await PaymentModel.updateMany(
            {orderId},
            {$set: {status: PaymentStatus.CANCEL_PENDING}},
            {session}
        );

        const job = {
            orderId,
            payments: payments.map((p) => ({
                _id: p._id as string,
                transactionId: p.transactionId,
                status: p.status
            })),
            createdAt: new Date().toISOString(),
        };

        await sendNotification(MessageQueueType.PAYMENT_CANCEL_REQUEST, ROUTING_KEYS.ORDERS.PAYMENT_CANCEL_REQUEST, job);

        return payments;
    }


    async paymentSuccess(transactionId: string, status: PaymentStatus, metadata?: Record<string, unknown>): Promise<void> {
        return runInTransaction(await database.getConnection(), async (session) => {
            const payment = await PaymentModel.findOneAndUpdate({
                transactionId,
                status: {
                    $in: [PaymentStatus.PENDING],
                }
            }, {status, metadata}, {
                new: true,
                session
            });
            if (payment) {
                const event = {
                    type: OrderEventType.ORDER_PLACED
                };

                const order = await OrderModel.findOneAndUpdate({_id: payment.orderId},
                    {
                        $set: {
                            status: OrderStatus.ACTIVE
                        },
                        $push: {
                            events: event
                        }
                    },
                    {
                        new: true,
                        session
                    });
                if (!order) throw new Error('Error payment');

                // TODO: ORDER:PUBLISH_MESSAGE:ORDER_STARTED
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
                            orderId: order._id as string,
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

                await sendNotification(MessageQueueType.ORDER_STARTED, ROUTING_KEYS.ORDERS.ORDER_STARTED, {
                    notification,

                    // email
                    buyerEmail: order.buyerEmail,
                    sellerEmail: order.sellerEmail,
                    orderId: order._id as string,
                    sellerUsername: order.sellerUsername.toLowerCase(),
                    buyerUsername: order.buyerUsername.toLowerCase(),
                    title: order.gigTitle,
                    description: order.gigDescription,
                    expectedDeliveryDate: order.expectedDeliveryDate,
                    quantity: order.quantity,
                    price: order.price,
                    serviceFee: order.serviceFee,
                    totalAmount: order.totalAmount,
                    orderUrl: `${config.CLIENT_URL}/orders/${order._id as string}`,

                    // Async task
                    // seller
                    sellerId: order.sellerId,
                    ongoingJobs: 1,

                    // // buyer
                    // buyerId: order[0].buyerId,
                    // purchasedGigs: order[0].gigId,

                    // chat
                    // buyerId: order.buyerId,
                    // sellerId: order.sellerId,
                    // orderId,
                    gigId: order.gigId,
                    isCustomOffer: false,
                });

                AppLogger.info(`Payment updated successfully`, {
                    operation: 'orders:update-extended-delivery',
                    context: {
                        orderId: payment.orderId,
                        transactionId,
                        updatedKeys: ['status']
                    }
                });
            }
        });
    }

    async refundSuccess(transactionId: string, status: PaymentStatus): Promise<void> {
        console.log(transactionId, status);
        const payment = await PaymentModel.findOneAndUpdate({
            transactionId,
            status: {
                $in: [PaymentStatus.REFUND_PENDING],
            }
        }, {status}, {
            new: true,
        });
        if (payment) {
            //
            // // TODO: ORDER:PUBLISH_MESSAGE:ORDER_STARTED
            // const notification: INotificationDocument = {
            //     _id: uuidv4(),
            //     recipient: {
            //         id: order.sellerId,
            //         role: 'seller',
            //         username: order.sellerUsername,
            //         avatar: order.sellerPicture ?? ''
            //     },
            //     payload: {
            //         extra: {
            //             orderId: order._id as string,
            //         },
            //         message: 'placed an order for your gig.'
            //     },
            //     actor: {
            //         id: order.buyerId,
            //         role: 'buyer',
            //         username: order.buyerUsername,
            //         avatar: order.buyerPicture ?? ''
            //     },
            //     timestamp: new Date().toISOString()
            // };
            //
            // await sendNotification(MessageQueueType.ORDER_STARTED, ROUTING_KEYS.ORDERS.ORDER_STARTED, {
            //     notification,
            //
            //     // email
            //     buyerEmail: order.buyerEmail,
            //     sellerEmail: order.sellerEmail,
            //     orderId: order._id as string,
            //     sellerUsername: order.sellerUsername.toLowerCase(),
            //     buyerUsername: order.buyerUsername.toLowerCase(),
            //     title: order.gigTitle,
            //     description: order.gigDescription,
            //     expectedDeliveryDate: order.expectedDeliveryDate,
            //     quantity: order.quantity,
            //     price: order.price,
            //     serviceFee: order.serviceFee,
            //     totalAmount: order.totalAmount,
            //     orderUrl: `${config.CLIENT_URL}/orders/${order._id as string}`,
            //
            //     // Async task
            //     // seller
            //     sellerId: order.sellerId,
            //     ongoingJobs: 1,
            //
            //     // // buyer
            //     // buyerId: order[0].buyerId,
            //     // purchasedGigs: order[0].gigId,
            //
            //     // chat
            //     // buyerId: order.buyerId,
            //     // sellerId: order.sellerId,
            //     // orderId,
            //     gigId: order.gigId,
            //     isCustomOffer: false,
            // });

            AppLogger.info(`Payment updated successfully`, {
                operation: 'orders:update-extended-delivery',
                context: {
                    orderId: payment.orderId,
                    transactionId,
                    updatedKeys: ['status']
                }
            });
        }
    }
}

// Export instance
export const paymentsService = new PaymentsService();
