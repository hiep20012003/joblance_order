import {Request, Response} from 'express';
import {StatusCodes, ReasonPhrases} from 'http-status-codes';
import {ErrorCode, NotFoundError, SuccessResponse} from '@hiep20012003/joblance-shared';
import {ordersService} from '@orders/services/orders.service';
import {
    OrderCreateDTO,
    OrderDeliveryDTO,
    OrderQueryDTO,
    OrderRequirementSubmitDTO
} from '@orders/schemas/order.schema';

class OrdersController {

    createOrderDirect = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as OrderCreateDTO;
        const order = await ordersService.createOrderDirect(payload);

        new SuccessResponse({
            message: 'Order created successfully',
            statusCode: StatusCodes.CREATED,
            reasonPhrase: ReasonPhrases.CREATED,
            data: order
        }).send(res);
    };

    createOrderFromOffer = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as OrderCreateDTO;
        const order = await ordersService.createOrderFromOffer(payload.orderId as string);

        new SuccessResponse({
            message: 'Order created successfully',
            statusCode: StatusCodes.CREATED,
            reasonPhrase: ReasonPhrases.CREATED,
            data: order
        }).send(res);
    };

    submitOrderRequirements = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as OrderRequirementSubmitDTO;
        const order = await ordersService.submitOrderRequirements(
            req.params.orderId,
            payload,
            req.files as Express.Multer.File[]
        );

        new SuccessResponse({
            message: 'Submit order requirements successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: order
        }).send(res);
    };

    deliverOrder = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as OrderDeliveryDTO;
        const order = await ordersService.deliverOrder(req.params.orderId, payload, req.files as Express.Multer.File[]);

        new SuccessResponse({
            message: 'Submit order requirements successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: order
        }).send(res);
    };

    cancelOrder = async (req: Request, res: Response): Promise<void> => {
        const order = await ordersService.cancelOrder(req.params.orderId, req.currentUser!.sub);

        new SuccessResponse({
            message: 'Order updated successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: order
        }).send(res);
    };

    approveOrderDelivery = async (req: Request, res: Response): Promise<void> => {
        const order = await ordersService.approveOrderDelivery(req.params.orderId);

        new SuccessResponse({
            message: 'Order updated successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: order
        }).send(res);
    };

    requestRevision = async (req: Request, res: Response): Promise<void> => {
        const order = await ordersService.requestRevision(req.params.orderId);

        new SuccessResponse({
            message: 'Order updated successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: order
        }).send(res);
    };

    getOrderById = async (req: Request, res: Response): Promise<void> => {
        const order = await ordersService.getOrderById(req.params.orderId);

        if (!order) {
            throw new NotFoundError({
                clientMessage: 'Order not found.',
                operation: 'orders:not-found',
                errorCode: ErrorCode.NOT_FOUND,
                context: {orderId: req.params.orderId}
            });
        }

        new SuccessResponse({
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: order
        }).send(res);
    };

    getOrders = async (req: Request, res: Response): Promise<void> => {
        const query = req.validatedQuery as OrderQueryDTO;
        const orders = await ordersService.getOrders(query);

        new SuccessResponse({
            message: 'Get orders successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: orders
        }).send(res);
    };
}

export const ordersController = new OrdersController();
