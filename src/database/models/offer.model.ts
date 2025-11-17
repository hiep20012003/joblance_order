import {Schema, model} from 'mongoose';
import {IOffer, OfferStatus} from '@hiep20012003/joblance-shared';
import {v4 as uuidv4} from 'uuid';

const offerSchema = new Schema<IOffer>(
    {
        _id: {
            type: String,
            default: () => uuidv4(),
            required: true
        },
        orderId: {type: String, default: uuidv4(), index: true},
        gigId: {type: String, required: true},
        buyerId: {type: String, required: true},
        sellerId: {type: String, required: true},

        // Snapshot
        gigTitle: {type: String, required: true},
        gigDescription: {type: String, required: true},
        buyerUsername: {type: String, required: true},
        buyerEmail: {type: String, required: true},
        buyerPicture: {type: String},
        sellerUsername: {type: String, required: true},
        sellerEmail: {type: String, required: true},
        sellerPicture: {type: String},
        gigCoverImage: {type: String},

        // Pricing
        currency: {type: String, default: 'USD'},
        quantity: {type: Number, required: true},
        price: {type: Number, required: true},

        expectedDeliveryDays: {type: Number, required: true},
        reason: {type: String, default: null},
        status: {type: String, enum: Object.values(OfferStatus), default: OfferStatus.PENDING},
        canceledBy: {type: String, default: null}
    },
    {timestamps: true, versionKey: false}
);

export const OfferModel = model<IOffer>('offers', offerSchema);
