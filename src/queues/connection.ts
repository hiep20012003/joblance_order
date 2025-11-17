import {MessageQueue, setupAllQueues} from '@hiep20012003/joblance-shared';
import {config} from '@orders/config';
import {AppLogger} from '@orders/utils/logger';
// import {consumeChatOfferMessage} from '@orders/queues/consumers/chat-offer.consumer';
// import {consumeOrderReviewMessage} from '@orders/queues/consumers/reviews.consumer';
import {consumeOrderRefundMessage} from '@orders/queues/consumers/refund.cunsumer';
import {consumeOrderPaymentMessage} from '@orders/queues/consumers/payment.cunsumer';

export const messageQueue = MessageQueue.getInstance(`${config.RABBITMQ_URL}`);

export const publishChannel: string = 'users-publish-channel';
export const consumerChannel: string = 'users-consumer-channel';

export async function initQueue() {
    await messageQueue.connect();
    AppLogger.info('RabbitMQ connection established successfully', {operation: 'queue:connect'});
    await setupAllQueues(messageQueue, (error: Error, queueName?: string) => {
        AppLogger.error(
            `[Setup] Failed to setup queue${queueName ? ` "${queueName}"` : ''}`,
            {
                operation: 'queue:setup-all',
                error: error,
            }
        );
    });
    // await consumeChatOfferMessage(messageQueue);
    // await consumeOrderReviewMessage(messageQueue);
    await consumeOrderRefundMessage(messageQueue);
    await consumeOrderPaymentMessage(messageQueue);

}