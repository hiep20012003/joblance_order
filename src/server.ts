import * as http from 'node:http';

import {AppLogger} from '@orders/utils/logger';
import {Application, json, NextFunction, urlencoded, Request, Response} from 'express';
import {
    ApplicationError,
    ErrorResponse,
    NotFoundError,
    ResponseOptions,
    ServerError
} from '@hiep20012003/joblance-shared';
import hpp from 'hpp';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import {config} from '@orders/config';
import {appRoutes} from '@orders/routes';
import {initQueue} from '@orders/queues/connection';
import {database} from '@orders/database/connection';

const SERVER_PORT = config.PORT || 4006;

export class OrdersServer {
    private readonly app: Application;

    constructor(app: Application) {
        this.app = app;
    }

    public async start(): Promise<void> {
        await database.connect();
        await this.startQueues();
        this.startRedis();
        this.securityMiddleware(this.app);
        this.standardMiddleware(this.app);
        this.routesMiddleware(this.app);
        this.errorHandler(this.app);
        this.startServer(this.app);
    }

    private securityMiddleware(app: Application): void {
        app.set('trust proxy', 1);
        app.use(hpp());
        app.use(helmet());
        app.use(
            cors({
                origin: config.API_GATEWAY_URL,
                credentials: true,
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
            })
        );
    }

    private standardMiddleware(app: Application): void {
        app.use(compression());
        app.use((req, res, next) => {
            if (req.path.includes('/webhooks/stripe')) {
                return next();
            }
            return json({limit: '200mb'})(req, res, next);
        });
        app.use(urlencoded({extended: true, limit: '200mb'}));
    }

    private routesMiddleware(app: Application): void {
        appRoutes(app);
    }

    private async startQueues(): Promise<void> {
        await initQueue();
    }

    private startRedis() {
        // cacheStore.connect();
    }

    private errorHandler(app: Application): void {
        app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
            const operation = 'server:handle-error';

            AppLogger.error(
                `API ${req.originalUrl} unexpected error`,
                {
                    operation,
                    error: err instanceof ApplicationError ? err.serialize() : {
                        name: (err as Error).name,
                        message: (err as Error).message,
                        stack: (err as Error).stack,
                    }
                }
            );

            if (err instanceof ApplicationError) {
                new ErrorResponse({
                    ...err.serializeForClient() as ResponseOptions,

                }).send(res, true);
            } else {
                const serverError = new ServerError({
                    clientMessage: 'Internal server error',
                    cause: err,
                    operation
                });
                new ErrorResponse({
                    ...serverError.serializeForClient() as ResponseOptions
                }).send(res, true);
            }
        });

        app.use('/*splat', (req: Request, res: Response, _next: NextFunction) => {
            const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
            const operation = 'server:route-not-found';

            const err = new NotFoundError({
                clientMessage: `Endpoint not found: ${fullUrl}`,
                operation
            });

            AppLogger.error(
                `API ${req.originalUrl} route not found`,
                {
                    operation,
                    error: !(err instanceof ApplicationError) ? {
                        name: (err as Error).name,
                        message: (err as Error).message,
                        stack: (err as Error).stack,
                    } : err.serialize()
                }
            );
            new ErrorResponse({
                ...err.serializeForClient() as ResponseOptions
            }).send(res, true);
        });
    }

    private startServer(app: Application): void {
        try {
            const httpServer: http.Server = new http.Server(app);
            this.startHttpServer(httpServer);
        } catch (error) {
            throw new ServerError({
                clientMessage: 'Failed to start Orders Service server',
                cause: error,
                operation: 'server:error'
            });
        }
    }

    private startHttpServer(httpServer: http.Server): void {
        try {
            AppLogger.info(`Orders server started with process id ${process.pid}`, {operation: 'server:http-start'});

            httpServer.listen(SERVER_PORT, () => {
                AppLogger.info(`Orders server is running on port ${SERVER_PORT}`, {operation: 'server:http-listening'});
            });
        } catch (error) {
            throw new ServerError({
                clientMessage: 'Failed to bind HTTP port',
                cause: error,
                operation: 'server:bind-error'
            });
        }
    }
}