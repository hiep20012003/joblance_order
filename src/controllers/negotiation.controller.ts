import {Request, Response} from 'express';
import {ReasonPhrases, StatusCodes} from 'http-status-codes';
import {NegotiationCreateDTO, NegotiationUpdateDTO} from '@orders/schemas/negotiation.schema';
import {negotiationService} from '@orders/services/negotiation.service';
import {SuccessResponse} from '@hiep20012003/joblance-shared';

class NegotiationController {

    getNegotiationById = async (req: Request, res: Response): Promise<void> => {
        const negotiation = await negotiationService.getNegotiationById(req.params.negotiationId);

        new SuccessResponse({
            message: 'Create negotiation successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: negotiation
        }).send(res);
    };

    createNegotiation = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as NegotiationCreateDTO;
        const negotiation = await negotiationService.createNegotiation(payload);

        new SuccessResponse({
            message: 'Create negotiation successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: negotiation
        }).send(res);
    };

    approveNegotiation = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as NegotiationUpdateDTO;
        const negotiation = await negotiationService.approveNegotiation(req.params.negotiationId, payload);

        new SuccessResponse({
            message: 'Approve negotiation successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: negotiation
        }).send(res);
    };

    rejectNegotiation = async (req: Request, res: Response): Promise<void> => {
        const payload = req.body as NegotiationUpdateDTO;
        const negotiation = await negotiationService.rejectNegotiation(req.params.negotiationId, payload);

        new SuccessResponse({
            message: 'Reject negotiation successfully',
            statusCode: StatusCodes.OK,
            reasonPhrase: ReasonPhrases.OK,
            data: negotiation
        }).send(res);
    };
}

export const negotiationController = new NegotiationController();
