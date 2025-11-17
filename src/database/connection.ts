import mongoose from 'mongoose';
import {AppLogger} from '@orders/utils/logger';
import {ServerError} from '@hiep20012003/joblance-shared';
import {config} from '@orders/config';
import {OrderModel} from '@orders/database/models/order.model';

export class Database {
    private static instance: Database;
    private connection: mongoose.Connection | null = null;

    private constructor() {
    }

    public static getInstance(): Database {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    public async connect(): Promise<mongoose.Connection> {
        if (this.connection && this.connection.readyState === mongoose.ConnectionStates.connected) {
            return this.connection;
        }

        try {
            const conn = await mongoose.connect(config.DATABASE_URL);
            this.connection = conn.connection;
            AppLogger.info(' Connected to MongoDB', {operation: 'db:connect'});
            return this.connection;
        } catch (error) {
            throw new ServerError({
                logMessage: 'Failed to connect to MongoDB',
                cause: error,
                operation: 'db:connect-error',
            });
        }
    }

    public async close(): Promise<void> {
        if (!this.connection || this.connection.readyState !== mongoose.ConnectionStates.connected) {
            AppLogger.info('No active connection to close', {operation: 'db:close'});
            return;
        }

        await mongoose.disconnect();
        this.connection = null;
        AppLogger.info('Disconnected from MongoDB', {operation: 'db:close'});
    }

    /**
     * Đảm bảo luôn có connection trước khi trả về
     */
    public async getConnection(): Promise<mongoose.Connection> {
        if (!this.connection || this.connection.readyState !== mongoose.ConnectionStates.connected) {
            return this.connect();
        }
        return this.connection;
    }
}


export const database = Database.getInstance();

export const dbContext = {
    connection: database.getConnection(),
    OrderModel
};
