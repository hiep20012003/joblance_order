import {z} from 'zod';

export const offerCreateSchema = z.object({
    orderId: z.string({message: 'Order ID is required'}).optional(),
    gigId: z.string({message: 'Gig ID is required'}),
    buyerId: z.string({message: 'Buyer ID is required'}),
    sellerId: z.string({message: 'Seller ID is required'}),

    gigTitle: z.string().min(1, {message: 'Gig title is required'}),
    gigDescription: z.string().min(1, {message: 'Gig description is required'}),
    gigCoverImage: z.url(),

    buyerUsername: z.string().min(1, {message: 'Buyer username is required'}),
    buyerEmail: z.email({message: 'Buyer email is required'}),
    buyerPicture: z.url(),

    sellerUsername: z.string().min(1, {message: 'Seller username is required'}),
    sellerEmail: z.email({message: 'Seller email is required'}),
    sellerPicture: z.url(),

    expectedDeliveryDays: z.number({message: 'Expected delivery days is required'}).int(),

    quantity: z.number({message: 'Quantity is required'}).int().positive({message: 'Quantity must be greater than 0'}),
    price: z.number({message: 'Price is required'}).positive({message: 'Price must be greater than 0'}),
});

export type OfferCreateDTO = z.infer<typeof offerCreateSchema>;
