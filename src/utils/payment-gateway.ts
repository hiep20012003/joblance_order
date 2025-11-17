import {config} from '@orders/config';
import Stripe from 'stripe';

export const stripeClient = new Stripe(config.STRIPE_SECRET_KEY, {apiVersion: '2025-08-27.basil'});
