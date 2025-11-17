

import { AppLogger } from '@orders/utils/logger';
import { EXCHANGES, MessageQueue } from '@hiep20012003/joblance-shared';
import { handleOrderReviewMessage } from '@orders/queues/handlers/reviews.handler';

import { consumerChannel } from '../connection';

export async function consumeOrderReviewMessage(messageQueue: MessageQueue) {
  const exchange = EXCHANGES.REVIEWS.name;
  const queue = 'order.reviews';

  await messageQueue.consume({
    channelName: consumerChannel,
    exchange,
    queue,
    handler: handleOrderReviewMessage,
    handlerRetryError: (operation: string, context)=>{
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
    context: { queue, exchange },
  });
}
