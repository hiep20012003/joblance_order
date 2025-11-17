import {AppLogger} from '@orders/utils/logger';
import {EXCHANGES, MessageQueue} from '@hiep20012003/joblance-shared';
import {handleOrderPaymentMessage} from '@orders/queues/handlers/payment.handler';

import {consumerChannel} from '../connection';

export async function consumeOrderPaymentMessage(messageQueue: MessageQueue) {
    const exchange = EXCHANGES.ORDERS.name;
    const queue = 'payment.orders';

    await messageQueue.consume({
        channelName: consumerChannel,
        exchange,
        queue,
        handler: handleOrderPaymentMessage,
        handlerRetryError: (operation: string, context) => {
            AppLogger.error(
                `Exceeded max retries`,
                {
                    operation,
                    context
                }
            );
        },
        maxRetries: 5,
    });

    AppLogger.info('Review message consumer listening to queue', {
        operation: 'consumer:init',
        context: {queue, exchange},
    });
}
