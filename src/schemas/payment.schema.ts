import {z} from 'zod';

export const paymentQuerySchema = z.object({
    status: z.string().optional(),
})

export const paymentPreviewSchema = z.object({
    gigId: z.string().min(1, {message: 'Gig ID must be required.'}),
    buyerId: z.string().min(1, {message: 'Buyer ID must be required.'}),
    quantity: z.number({message: 'Quantity is required'}).int().positive({message: 'Quantity must be greater than 0'}),
});

export const paymentValidateSchema = z.object({
    orderId: z.string({message: 'Order ID is required'}).optional(),
    buyerId: z.string().min(1, {message: 'Buyer ID must be required.'}),
    gigId: z.string().min(1, {message: 'Gig ID must be required.'}),
})

export type PaymentQueryDTO = z.infer<typeof paymentQuerySchema>;
export type PaymentPreviewDTO = z.infer<typeof paymentPreviewSchema>;
export type PaymentValidateDTO = z.infer<typeof paymentValidateSchema>;

// export type GigUpdateDTO = z.infer<typeof gigUpdateSchema>;
