import {Request, Response} from 'express';
import {ReasonPhrases, StatusCodes} from 'http-status-codes';
import {PaymentStatus, SuccessResponse} from '@hiep20012003/joblance-shared';
import {paymentsService} from '@orders/services/payments.service';
import Stripe from 'stripe';
import {config} from '@orders/config';
import {PaymentPreviewDTO, PaymentValidateDTO} from '@orders/schemas/payment.schema';

const stripe = new Stripe(config.STRIPE_SECRET_KEY, {typescript: true});
const stripeWebhookSecret = config.STRIPE_WEBHOOK_SECRET;

class PaymentsController {
    previewOrder = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as PaymentPreviewDTO;
        const preview = await paymentsService.calculateOrderCost(payload.gigId, payload.buyerId, payload.quantity);

        new SuccessResponse({
            message: 'Preview order cost',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: preview
        }).send(res);
    };

    validate = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as PaymentValidateDTO;
        const preview = await paymentsService.validate(payload);

        new SuccessResponse({
            message: 'Preview order cost',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: preview
        }).send(res);
    };

    getPaymentsByOrder = async (req: Request, res: Response): Promise<void> => {
        const orderId = req.params.orderId;
        const query = req.query;
        const payments = await paymentsService.getPaymentsByOrder(orderId, query);

        new SuccessResponse({
            message: 'Get payments successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: payments
        }).send(res);
    };

    stripeWebhook = async (req: Request, res: Response): Promise<void> => {
        const sig = req.headers['stripe-signature'] as string;
        let event: Stripe.Event;

        try {
            const payload = req.body as string | Buffer;
            event = stripe.webhooks.constructEvent(payload, sig, stripeWebhookSecret);
        } catch (err) {
            console.log(err);
            res.status(StatusCodes.BAD_REQUEST).send(`Webhook Error: ${(err as Error).message}`);
            return;
        }


        console.log(event.type);
        let paymentIntent;
        let refund;
        let transactionId;
        switch (event.type) {
            case 'payment_intent.succeeded':
                paymentIntent = event.data.object;
                transactionId = paymentIntent.id;
                await paymentsService.paymentSuccess(transactionId, PaymentStatus.PAID);
                break;

            case 'refund.updated':
                refund = event.data.object;
                if (refund.status === 'succeeded') {
                    transactionId = refund.payment_intent;
                    await paymentsService.refundSuccess(transactionId as string, PaymentStatus.REFUNDED);
                }
                break;

            // case 'payment_intent.requires_action':
            //   await paymentsService.updatePayment(transactionId, PaymentStatus.FAILED);
            //   break;

            // case 'payment_intent.canceled':
            //     await paymentsService.paymentSuccess(transactionId, PaymentStatus.CANCELED);
            //     break;
        }

        res.status(200).json({received: true});
    };

    // Webhook PayPal
    paypalWebhook = async (_req: Request, res: Response): Promise<void> => {
        // const payload = req.body as PayPalWebhookPayload;
        // await paymentsService.updatePayment(payload, PaymentGateway.PAYPAL);
        await Promise.resolve();

        res.status(StatusCodes.OK).send();
    };
}

export const paymentsController = new PaymentsController();
