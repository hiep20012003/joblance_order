import { Application } from 'express';
import { createVerifyGatewayRequest } from '@hiep20012003/joblance-shared';
import { config } from '@orders/config';
import { paymentsRoutes } from '@orders/routes/payments.route';
import { healthRoutes } from '@orders/routes/health.route';
import { ordersRoutes } from '@orders/routes/orders.route';
import seedRoutes from '@orders/routes/seed.route';
import { initialContextMiddleware } from '@orders/middlewares/context.middleware';
import { negotiationRoutes } from '@orders/routes/negotiation.route';

const BASE_PATH = '/api/v1';

export const appRoutes = (app: Application) => {
  app.use('', healthRoutes.routes());
  app.use(initialContextMiddleware);
  app.use(BASE_PATH, createVerifyGatewayRequest(`${config.GATEWAY_SECRET_KEY}`), ordersRoutes.routes());
  app.use(BASE_PATH, createVerifyGatewayRequest(`${config.GATEWAY_SECRET_KEY}`), paymentsRoutes.routes());
  app.use(BASE_PATH, createVerifyGatewayRequest(`${config.GATEWAY_SECRET_KEY}`), negotiationRoutes.routes());

  app.use('/seed', seedRoutes);
};
