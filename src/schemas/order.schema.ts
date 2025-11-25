import { z } from 'zod';
import {
  OrderStatus,
  sanitizeBoolean,
  sanitizeNumber,
  sanitizeString,
  parseArray
} from '@hiep20012003/joblance-shared';


export const orderCreateSchema = z.object({
  orderId: z.string({ message: 'Order ID is required' }).optional(),
  gigId: z.string({ message: 'Gig ID is required' }),
  buyerId: z.string({ message: 'Buyer ID is required' }),
  sellerId: z.string({ message: 'Seller ID is required' }),

  gigTitle: z.string().min(1, { message: 'Gig title is required' }),
  gigDescription: z.string().min(1, { message: 'Gig description is required' }),
  gigCoverImage: z.string(),

  buyerUsername: z.string().min(1, { message: 'Buyer username is required' }),
  buyerEmail: z.email({ message: 'Buyer email is required' }),
  buyerPicture: z.string().optional(),

  sellerUsername: z.string().min(1, { message: 'Seller username is required' }),
  sellerEmail: z.email({ message: 'Seller email is required' }),
  sellerPicture: z.string().optional(),

  expectedDeliveryDays: z.number({ message: 'Expected delivery days is required' }).int(),

  quantity: z.number({ message: 'Quantity is required' }).int().positive({ message: 'Quantity must be greater than 0' }),
  maxRevision: z.number().int().positive({ message: 'Max revision must be greater than 0' }).nullable().default(null),

  requirements: z.preprocess(parseArray, z.array(z.object({
    requirementId: z.string().min(1, { message: 'requirementId is required' }),
    question: z
      .string()
      .min(1, { message: 'Question is required' })
      .max(1000, { message: 'Question must be at most 1000 characters' }),
    hasFile: z.boolean(),
    required: z.boolean(),
  }))),
});

// export const submitOrderRequirementsSchema = z.object({
//   requirements: z.preprocess((val) => {
//     const arr = parseArray<IOrderRequirement>(val);
//
//     return arr;
//   }, z.array(
//     z.object({
//       requirementId: z.string().min(1, { message: 'requirementId is required' }),
//       question: z.string()
//         .min(1, { message: 'Question is required' })
//         .max(500, { message: 'Question must be at most 500 characters' }),
//       answerText: z.string()
//         .max(2500, { message: 'Answer text must be at most 2500 characters' })
//         .optional(),
//       answered: z.boolean().default(false),
//       hasFile: z.boolean().default(false)
//     })
//   ).min(1, { message: 'At least one requirement must be submitted' }))
// });

export const submitOrderRequirementsSchema = z.object({
  requirements: z.preprocess(
    parseArray,
    z.array(
      z
        .object({
          requirementId: z.string().min(1, { message: 'requirementId is required' }),
          hasFile: z.boolean(),
          answerText: z
            .string()
            .max(2000, { message: 'Answer must be at most 2000 characters' })
            .optional(),
          question: z
            .string()
            .min(1, { message: 'Question must be required' })
            .max(1000, { message: 'Question must be at most 1000 characters' }),
          required: z.boolean(),
        })
        .superRefine((data, ctx) => {
          if (!data.hasFile && (!data.answerText || data.answerText.trim().length === 0)) {
            ctx.addIssue({
              path: ['answerText'],
              message: 'Answer text is required',
              code: 'custom',
            });
          }
        })
    ).min(1, { message: 'At least one requirement must be submitted' })
  ),
});


export const deliverOrderSchema = z.object({
  message: z.string().min(1, { message: 'Message is required' }),
});

export const requestExtendedDeliveryUpdateSchema = z.object({
  approved: z.boolean(),
  approvedBy: z.enum(['buyer', 'seller'])
});

export const cancelCustomOfferSchema = z.object({
  orderId: z.string().min(1),
  sellerId: z.string().min(1),
  buyerId: z.string().min(1),
  gigId: z.string().min(1),
});


export const orderQuerySchema = z
  .object({
    status: z.preprocess(
      parseArray,
      z.array(z.enum(Object.values(OrderStatus))).optional()),
    // status: sanitizeString(z.enum(OrderStatus)).optional(),
    buyerId: sanitizeString(z.string()).optional(),
    sellerId: sanitizeString(z.string()).optional(),
    gigId: sanitizeString(z.string()).optional(),
    isCustomOffer: sanitizeBoolean().optional(),

    search: z.string().optional(),
    late: sanitizeBoolean().optional(),
    priority: sanitizeBoolean().optional(),

    limit: sanitizeNumber(z.number().min(1).max(100)).default(10),
    page: sanitizeNumber(z.number().min(1)).default(1),

    sortBy: z.enum(['createdAt', 'updatedAt', 'price', 'dateOrdered', 'dueDate']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
;

export type OrderCreateDTO = z.infer<typeof orderCreateSchema>;
export type OrderRequirementSubmitDTO = z.infer<typeof submitOrderRequirementsSchema>;
export type OrderDeliveryDTO = z.infer<typeof deliverOrderSchema>;
export type OfferCancelDTO = z.infer<typeof cancelCustomOfferSchema>;
export type OrderQueryDTO = z.infer<typeof orderQuerySchema>;
