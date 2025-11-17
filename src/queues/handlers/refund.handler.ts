import {
    IPaymentDocument,
    MessageQueueType,
    PaymentStatus,
} from '@hiep20012003/joblance-shared';
import {AppLogger} from '@orders/utils/logger';
import {stripeClient} from '@orders/utils/payment-gateway';
import {PaymentModel} from '@orders/database/models/payment.model';

export async function handleOrderRefundMessage<
    T extends Required<{
        type: MessageQueueType;
        orderId: string; payments: IPaymentDocument[]; createdAt: string
    }>
>(payload: T): Promise<void> {
    const {orderId, payments, type} = payload;

    switch (type) {
        case MessageQueueType.ORDER_REFUND_REQUEST: {
            AppLogger.info('Processing refund job', {
                operation: 'queue:processing-refund',
                context: {orderId: orderId},
            });

            const errors: string[] = [];

            for (const payment of payments) {
                try {
                    if (payment.status === PaymentStatus.REFUNDED) {
                        AppLogger.info('Skipping already refunded payment (DB)', {
                            operation: 'refund:skip-db',
                            context: {paymentId: payment.id, orderId: orderId},
                        });
                        continue;
                    }

                    const idempotencyKey = `refund_${payment._id || payment.transactionId}`;
                    const refund = await stripeClient.refunds.create(
                        {payment_intent: payment.transactionId},
                        {idempotencyKey}
                    );

                    const result = await PaymentModel.updateOne(
                        {_id: payment._id},
                        {
                            $set: {
                                'metadata.refundId': refund.id,
                                'metadata.refundedAt': new Date().toISOString(),
                            },
                        }
                    );

                    const pp = await PaymentModel.findOne(
                        {_id: payment._id},
                    );

                    console.log(pp, result);

                    AppLogger.info('Refunded payment successfully', {
                        operation: 'refund:success',
                        context: {paymentId: payment.id, orderId: orderId},
                    });
                } catch (err: unknown) {
                    const errorMsg = err instanceof Error ? err.message : String(err);

                    AppLogger.error('Stripe refund failed', {
                        operation: 'refund:failed',
                        context: {
                            orderId: orderId,
                            paymentId: payment.id,
                            error: errorMsg,
                        },
                    });

                    await PaymentModel.updateOne(
                        {_id: payment.id},
                        {
                            $set: {
                                status: PaymentStatus.REFUND_FAILED,
                                error: errorMsg,
                            },
                        }
                    );

                    // thêm lỗi để queue service retry
                    errors.push(`Payment ${payment.id} refund failed: ${errorMsg}`);
                }
            }

            // nếu có lỗi, throw để hệ thống queue tự retry
            if (errors.length > 0) {
                const error = new Error(
                    `Refund job failed for order ${orderId}. Failed payments: ${errors.length}`
                );
                (error as any).details = errors;
                throw error;
            }

            AppLogger.info('Refund job completed successfully', {
                operation: 'refund:completed',
                context: {orderId: orderId},
            });

            break;
        }

        default:
            AppLogger.warn(`[Order Refund Handler] Unhandled event type: ${type}`, {
                operation: 'consumer:handler',
            });
            break;
    }
}
