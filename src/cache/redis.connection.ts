import {config} from '@orders/config';
import {AppLogger} from '@orders/utils/logger';
import {RedisClient} from '@hiep20012003/joblance-shared';
import {v4 as uuidv4} from 'uuid';

export class CacheStore extends RedisClient {
    public async saveInternalToken(userId: string, gigId: string, orderId: string): Promise<void> {
        const key = `pending_payment:${userId}:${gigId}`;
        await this.client.setex(key, 60 * 60 * 24, orderId);
    }

    public async getInternalToken(userId: string, gigId: string): Promise<string | null> {
        const key = `pending_payment:${userId}:${gigId}`;
        return this.client.get(key);
    }

    public async withLock<T>(
        key: string,
        ttl: number,
        fn: () => Promise<T>,
        retryDelay = 100,
        maxRetry = 3
    ): Promise<T> {
        const value = uuidv4();
        let attempts = 0;

        while (attempts < maxRetry) {
            const acquired = await this.acquireLock(key, value, ttl);
            if (acquired) {
                try {
                    return await fn();
                } finally {
                    await this.releaseLock(key, value);
                }
            }

            attempts++;
            await new Promise((res) => setTimeout(res, retryDelay));
        }

        throw new Error(`Failed to acquire lock for key: ${key}`);
    }

    /** SET key NX PX ttl */
    private async acquireLock(key: string, value: string, ttl: number): Promise<boolean> {
        const result = await this.client.call('SET', key, value, 'NX', 'PX', ttl) as string | null;
        return result === 'OK';
    }

    /** Release lock an toàn bằng Lua script */
    private async releaseLock(key: string, value: string): Promise<void> {
        const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
        try {
            const result = await this.client.eval(script, 1, key, value) as number;
            if (result === 0) {
                this.logger.warn('Lock was not released because value did not match', {
                    operation: 'redis:release-lock',
                    context: {key}
                });
            }
        } catch (err) {
            this.logger.warn('Failed to release Redis lock', {
                operation: 'redis:release-lock',
                context: {key, error: err}
            });
        }
    }

}

export const cacheStore = new CacheStore(config.REDIS_URL, AppLogger);
