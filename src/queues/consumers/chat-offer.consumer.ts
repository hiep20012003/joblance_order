

import { AppLogger } from '@orders/utils/logger';
import { EXCHANGES, MessageQueue } from '@hiep20012003/joblance-shared';
import { handleChatOfferMessage } from '@orders/queues/handlers/chat-offer.handler';

import { consumerChannel } from '../connection';

export async function consumeChatOfferMessage(messageQueue: MessageQueue) {
  const exchange = EXCHANGES.CHATS.name;
  const queue = 'order.chats';

  await messageQueue.consume({
    channelName: consumerChannel,
    exchange,
    queue,
    handler: handleChatOfferMessage,
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

  AppLogger.info('Chats message consumer listening to queue', {
    operation: 'consumer:init',
    context: { queue, exchange },
  });
}
