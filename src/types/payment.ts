import Stripe from 'stripe';

export type PayPalOrderLink = {
  href: string;
  rel: string;
  method: string;
};

export type PayPalOrder = {
  id: string;
  links?: PayPalOrderLink[];
};

export interface PayPalWebhookPayload {
  event_type: string;
  resource: {
    id: string;
    amount: {
      value: string;
      currency_code: string;
    };
  };
}

export type StripeWebhookPayload = Stripe.Event;

