import {Schema, model} from 'mongoose';
import {IPaymentDocument, PaymentGateway, PaymentStatus} from '@hiep20012003/joblance-shared';
import {v4 as uuidv4} from 'uuid';

const PaymentSchema = new Schema<IPaymentDocument>(
    {
        _id: {
            type: String,
            default: () => uuidv4(),
            required: true
        },
        orderId: {type: String, ref: 'Order', required: true, index: true},
        gateway: {type: String, enum: Object.values(PaymentGateway), default: null},
        amount: {type: Number, required: true},
        currency: {type: String, default: 'USD'},
        status: {type: String, enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING},
        transactionId: {type: String},
        clientSecret: {type: String},
        paymentUrl: {type: String},
        parentPaymentId: {type: String, default: null},
        metadata: {type: Schema.Types.Mixed, default: undefined}
    },
    {timestamps: true, versionKey: false}
);


export const PaymentModel = model<IPaymentDocument>('payments', PaymentSchema);
