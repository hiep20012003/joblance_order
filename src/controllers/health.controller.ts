import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

class HealthController {
  constructor() {}

  health = (_req: Request, res: Response): void => {
    res.status(StatusCodes.OK).send('Orders Service is healthy and OK');
  };
}

export const healthController: HealthController = new HealthController();