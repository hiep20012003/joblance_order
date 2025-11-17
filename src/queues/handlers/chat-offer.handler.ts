import {IChatMessageQueue, MessageQueueType} from '@hiep20012003/joblance-shared';
import {AppLogger} from '@orders/utils/logger';

export async function handleChatOfferMessage<T extends Required<IChatMessageQueue>>(payload: T): Promise<void> {
    await Promise.resolve();
    const {
        type,
        // gigId,
        // buyerId,
        // sellerId,
        // orderId,
    } = payload;
    switch (type) {
        case MessageQueueType.CUSTOM_OFFER_CANCELLED: {
            // const data = {
            //   gigId,
            //   buyerId,
            //   sellerId,
            //   orderId,
            // };
            // await ordersService.cancelCustomOffer(notification.actor.role, data);
            break;
        }
        default:
            AppLogger.warn(`[Order Order Handler] Unhandled event type: ${type}`, {operation: 'consumer:handler'});
            break;
    }
}

