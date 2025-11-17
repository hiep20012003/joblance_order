import {
  IReviewMessageQueue,
  MessageQueueType,
} from '@hiep20012003/joblance-shared';
import { AppLogger } from '@orders/utils/logger';
import { ordersService } from '@orders/services/orders.service';

export async function handleOrderReviewMessage<T extends Required<IReviewMessageQueue>>(payload: T): Promise<void> {
  const { type } = payload;
  switch (type) {
    case MessageQueueType.BUYER_REVIEWED:
    case MessageQueueType.SELLER_REVIEWED:
      await ordersService.updateOrderReview(payload);
      break;
    default:
      AppLogger.warn(`[Order Order Handler] Unhandled event type: ${type}`, { operation: 'consumer:handler' });
      break;
  }
}

