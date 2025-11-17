import crypto from 'crypto';

import {EXCHANGES, IOrderMessageQueue, MessageQueueType} from '@hiep20012003/joblance-shared';
import {messageQueue, publishChannel} from '@orders/queues/connection';
import {AppLogger} from '@orders/utils/logger';

export function generateInvoiceId(): string {
    const date = new Date();
    const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 1000000)
        .toString()
        .padStart(6, '0');

    return `INV-${yyyymmdd}-${random}`;
}

export function generateRequirementFileId(orderId: string, requirementId: string): string {
    const raw = `${orderId}${requirementId}`;
    const hash = crypto.createHash('md5').update(raw).digest('hex');
    return hash;
}

export async function sendNotification(
    type: MessageQueueType,
    routingKey: string,
    payload: Partial<IOrderMessageQueue>
): Promise<void> {
    // TODO: ORDER:PUBLISH_MESSAGE

    const exchange = EXCHANGES.ORDERS.name;

    const message: IOrderMessageQueue = {
        type,
        ...payload
    };
    await messageQueue.publish({
        channelName: publishChannel,
        exchange,
        routingKey,
        message: JSON.stringify(message)
    });

    AppLogger.info(`Published ${routingKey} to ${exchange} successfully`, {
        operation: 'queue:publish',
        context: {
            type,
            status: 'published',
            exchange,
            routingKey
        }
    });
}