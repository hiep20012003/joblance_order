import {AppLogger} from '@orders/utils/logger';
import {EXCHANGES, MessageQueue} from '@hiep20012003/joblance-shared';

import {consumerChannel} from '../connection';
import {handleOrderRefundMessage} from '@orders/queues/handlers/refund.handler';

export async function consumeOrderRefundMessage(messageQueue: MessageQueue) {
    const exchange = EXCHANGES.ORDERS.name;
    const queue = 'refund.orders';

    await messageQueue.consume({
        channelName: consumerChannel,
        exchange,
        queue,
        handler: handleOrderRefundMessage,
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
