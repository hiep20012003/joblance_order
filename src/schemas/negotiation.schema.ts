import {z} from 'zod';
import {NegotiationType} from '@hiep20012003/joblance-shared';

const negotiationTypeEnum = z.enum(Object.values(NegotiationType));
const requesterRoleEnum = z.enum(['seller', 'buyer']);

export const extendDeliveryPayloadSchema = z.object({
    newDeliveryDays: z.number().int().positive('New delivery days must be a positive integer.'),
    originalDeliveryDate: z.union([z.iso.datetime(), z.date()]).optional(),
});

export const cancelOrderPayloadSchema = z.object({
    reason: z.string().min(10, 'Cancellation reason must be at least 10 characters long.'),
});

export const modifyOrderPayloadSchema = z
    .object({
        newPrice: z.number().positive('New price must be a positive number.').optional(),
        newScopeDescription: z.string().min(20, 'New scope description must be more detailed.').optional(),
    })
    .refine(
        (data) => data.newPrice !== undefined || data.newScopeDescription !== undefined,
        {
            message: 'You must provide either a new price or a new scope description.',
        }
    );

export const createNegotiationSchema = z.object({
    orderId: z.string('orderId must be a valid UUID.'),
    type: negotiationTypeEnum,
    requesterId: z.string('requesterId must be a valid UUID.'),
    requesterRole: requesterRoleEnum,
    message: z.string().min(5, 'Negotiation message must be clear and meaningful.').max(2000),
    payload: z.union([
        extendDeliveryPayloadSchema,
        cancelOrderPayloadSchema,
        modifyOrderPayloadSchema,
    ]),
});

export const updateNegotiationSchema = z.object({
    actorId: z.string('actorId (approver/decliner) must be a valid UUID.'),
});

export const escalateDisputeSchema = z.object({
    negotiationId: z.string('negotiationId must be a valid UUID.'),
    actorId: z.string('actorId (escalating user) must be a valid UUID.'),
    reason: z.string().min(10, 'Dispute escalation reason must be at least 10 characters long.'),
});


export type NegotiationCreateDTO = z.infer<typeof createNegotiationSchema>;
export type NegotiationUpdateDTO = z.infer<typeof updateNegotiationSchema>;
