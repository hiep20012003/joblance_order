import '@elastic/opentelemetry-node';

import express, {Express} from 'express';
import {OrdersServer} from '@orders/server';
import {AppLogger} from '@orders/utils/logger';

import {config} from './config';

class Application {
    private readonly app: Express;
    private server: OrdersServer;

    constructor() {
        this.app = express();
        this.server = new OrdersServer(this.app);
    }

    public async initialize(): Promise<void> {
        const operation = 'app:init';

        try {
            await this.server.start();
            AppLogger.info('Orders Service initialized', {operation});
        } catch (error) {
            AppLogger.error('', {operation, error});
            process.exit(1);
        }
    }
}

async function bootstrap(): Promise<void> {
    config.cloudinaryConfig();
    const application = new Application();
    await application.initialize();
}


// ---- Global error handlers ---- //
process.on('uncaughtException', (error) => {
    AppLogger.error('', {operation: 'app:uncaught-exception', error});
});

process.on('unhandledRejection', (reason) => {
    AppLogger.error('', {operation: 'app:unhandled-rejection', error: reason});
});

// ---- App Entry Point ---- //
bootstrap().catch((error) => {
    AppLogger.error('', {operation: 'app:bootstrap-failed', error});
});
