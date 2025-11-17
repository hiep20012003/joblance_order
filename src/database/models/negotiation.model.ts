// src/models/negotiation.model.ts

import {Schema, model} from 'mongoose';
import {v4 as uuidv4} from 'uuid';
import {INegotiationDocument, NegotiationStatus, NegotiationType} from '@hiep20012003/joblance-shared';

const negotiationSchema = new Schema<INegotiationDocument>(
    {
        _id: {
            type: String,
            default: () => uuidv4(),
            required: true,
        },
        orderId: {
            type: String,
            required: true,
            index: true,
        },
        // --- Chi tiết Negotiation ---
        type: {
            type: String,
            enum: Object.values(NegotiationType),
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(NegotiationStatus),
            default: NegotiationStatus.PENDING,
            required: true,
        },

        requesterId: {type: String, required: true},
        requesterRole: {type: String, enum: ['seller', 'buyer'], required: true},

        payload: {
            type: Schema.Types.Mixed,
            required: true,
            default: {},
        },
        message: {type: String, required: true},
        respondedAt: {type: Date, default: null},

        // --- Tranh chấp ---
        disputeCaseId: {type: String, default: null},
    },
    {
        timestamps: true,
        versionKey: false,
        collection: 'negotiations', // Đặt tên collection rõ ràng
    }
);

export const NegotiationModel = model<INegotiationDocument>('negotiations', negotiationSchema);