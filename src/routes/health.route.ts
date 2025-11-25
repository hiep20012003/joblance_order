import { healthController } from '@orders/controllers/health.controller';
import express, { Router } from 'express';

class HealthRoutes {
  private readonly router: Router;
  constructor() {
    this.router = express.Router();
  }

  public routes(): Router {
    this.router.get('/order-health', healthController.health);
    return this.router;
  }
}

export const healthRoutes: HealthRoutes = new HealthRoutes();
