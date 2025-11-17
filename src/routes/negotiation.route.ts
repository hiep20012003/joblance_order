import {handleAsyncError, validate} from '@hiep20012003/joblance-shared';
import express, {Router} from 'express';
import {negotiationController} from '@orders/controllers/negotiation.controller';
import {createNegotiationSchema, updateNegotiationSchema} from '@orders/schemas/negotiation.schema';

class NegotiationRoutes {
    private readonly router: Router;

    constructor() {
        this.router = express.Router();
    }

    public routes(): Router {

        this.router.get('/negotiations/:negotiationId', handleAsyncError(negotiationController.getNegotiationById));

        this.router.post('/negotiations', validate(createNegotiationSchema), handleAsyncError(negotiationController.createNegotiation));

        this.router.post('/negotiations/:negotiationId/approve', validate(updateNegotiationSchema), handleAsyncError(negotiationController.approveNegotiation));

        this.router.post('/negotiations/:negotiationId/reject', validate(updateNegotiationSchema), handleAsyncError(negotiationController.rejectNegotiation));

        return this.router;
    }
}

export const negotiationRoutes: NegotiationRoutes = new NegotiationRoutes();
