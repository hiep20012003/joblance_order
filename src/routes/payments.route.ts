import {handleAsyncError, validate} from '@hiep20012003/joblance-shared';
import express, {Router} from 'express';
import {paymentsController} from '@orders/controllers/payments.controller';
import {paymentPreviewSchema, paymentValidateSchema} from '@orders/schemas/payment.schema';

class PaymentsRoutes {
    private readonly router: Router;

    constructor() {
        this.router = express.Router();
    }

    public routes(): Router {

        this.router.post('/payments/preview', validate(paymentPreviewSchema), handleAsyncError(paymentsController.previewOrder));

        this.router.post('/payments/validate', validate(paymentValidateSchema), handleAsyncError(paymentsController.validate));

        this.router.post(
            '/webhooks/paypal',
            handleAsyncError(paymentsController.paypalWebhook)
        );

        this.router.post(
            '/webhooks/stripe',
            express.raw({type: 'application/octet-stream'}),
            handleAsyncError(paymentsController.stripeWebhook)
        );

        this.router.get('/orders/:orderId/payments', handleAsyncError(paymentsController.getPaymentsByOrder));

        return this.router;
    }
}

export const paymentsRoutes: PaymentsRoutes = new PaymentsRoutes();
