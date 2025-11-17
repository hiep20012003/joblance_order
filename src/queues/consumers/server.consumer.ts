import { AppLogger } from '@orders//utils/logger';
import { EXCHANGES, MessageQueue } from '@hiep20012003/joblance-shared';

import { consumerChannel } from '../connection';
import { handleServerMessage } from '../handlers/server.handler';


export async function consumeServerMessage(messageQueue: MessageQueue) {
  const exchange = EXCHANGES.SERVER.name;
  const queue = 'gig.users';
  
  await messageQueue.consume({
    channelName: consumerChannel,
    exchange,
    queue,
    handler: handleServerMessage,
    handlerRetryError: (operation: string, context: unknown)=>{
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

  AppLogger.info('Server message consumer listening to queue', {
    operation: 'consumer:init',
    context: { queue, exchange },
  });
}
