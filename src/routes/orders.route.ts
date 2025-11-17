import {ordersController} from '@orders/controllers/orders.controller';
import {
    orderQuerySchema,
    orderCreateSchema,
    deliverOrderSchema,
    submitOrderRequirementsSchema,
} from '@orders/schemas/order.schema';
import {
    ALL_GIG_DELIVERY_ALLOWED_MIMES, handleAsyncError, validate, validateMultipleFiles, validateQueryMiddleware
} from '@hiep20012003/joblance-shared';
import express, {Router} from 'express';
import multer from 'multer';

class OrdersRoutes {
    private readonly router: Router;

    constructor() {
        this.router = express.Router();
    }

    public routes(): Router {
        this.router.post('/orders', validate(orderCreateSchema), handleAsyncError(ordersController.createOrderDirect));
        this.router.post('/offer/orders', validate(orderCreateSchema), handleAsyncError(ordersController.createOrderFromOffer));

        const upload = multer({storage: multer.memoryStorage()});
        this.router.post(
            '/orders/:orderId/requirements',
            upload.array('requirementFiles', 10),
            validateMultipleFiles(ALL_GIG_DELIVERY_ALLOWED_MIMES),
            validate(submitOrderRequirementsSchema),
            handleAsyncError(ordersController.submitOrderRequirements)
        );

        this.router.post(
            '/orders/:orderId/deliveries',
            upload.array('deliveryFiles', 5),
            validateMultipleFiles(ALL_GIG_DELIVERY_ALLOWED_MIMES),
            validate(deliverOrderSchema),
            handleAsyncError(ordersController.deliverOrder)
        );

        this.router.get('/orders/:orderId', handleAsyncError(ordersController.getOrderById));
        this.router.get('/orders', validateQueryMiddleware(orderQuerySchema), handleAsyncError(ordersController.getOrders));

        this.router.post(
            '/orders/:orderId/deliveries/approve',
            handleAsyncError(ordersController.approveOrderDelivery)
        );

        this.router.post(
            '/orders/:orderId/deliveries/revise',
            handleAsyncError(ordersController.requestRevision)
        );

        this.router.post(
            '/orders/:orderId/cancel',
            handleAsyncError(ordersController.cancelOrder)
        );

        return this.router;
    }
}

export const ordersRoutes: OrdersRoutes = new OrdersRoutes();
