import {Schema, model} from 'mongoose';
import {
    OrderStatus,
    OrderEventType,
    IOrderDocument,
    IDeliveredWork,
    // IRequestExtendedDelivery (Đã loại bỏ)
    IOrderReview,
    IOrderEvent,
    IOrderRequirement,
    IFile
} from '@hiep20012003/joblance-shared';
import {v4 as uuidv4} from 'uuid';

const fileSchema = new Schema<IFile>({
    downloadUrl: {type: String, required: true},
    secureUrl: {type: String, required: true},
    fileType: {type: String, required: true},
    fileSize: {type: Number, required: true},
    fileName: {type: String, required: true},
    publicId: {type: String, required: true},
}, {_id: false});

const deliveredWorkSchema = new Schema<IDeliveredWork>(
    {
        _id: {
            type: String,
            default: () => uuidv4(),
            required: true
        },
        message: {type: String, required: true},
        files: {
            type: [fileSchema],
            required: true,
            validate: [(v: never[]) => v.length > 0, 'At least one file is required']
        },
        approved: {type: Boolean, nullable: true, default: null},
        approvedAt: {type: String, nullable: true, default: null},
        deliveredAt: {type: String, required: true, default: (new Date()).toISOString()},
        metadata: {type: Schema.Types.Mixed, default: undefined}
    },
);

const orderReviewSchema = new Schema<IOrderReview>(
    {
        _id: {type: String, required: true},
        rating: {type: Number, required: true},
        review: {type: String, required: true},
        timestamp: {type: String, required: true, default: (new Date()).toISOString()},
    },
);

const orderEventSchema = new Schema<IOrderEvent>(
    {
        type: {type: String, enum: Object.values(OrderEventType), required: true},
        timestamp: {type: String, required: true, default: (new Date()).toISOString()},
        metadata: {type: Schema.Types.Mixed, default: undefined}
    },
    {_id: false}
);

const orderRequirementSchema = new Schema<IOrderRequirement>({
    requirementId: {type: String, required: true},
    question: {type: String, required: true},
    answerText: {type: String, nullable: true, default: null},
    answerFile: {type: fileSchema, nullable: true, default: null},
    answered: {type: Boolean, default: false},
    hasFile: {type: Boolean, required: true},
    required: {type: Boolean, required: true},
}, {_id: false});


const cancellationDetailsSchema = new Schema({
    requestedBy: {type: String, enum: ['BUYER', 'SELLER'], required: true},
    reason: {type: String, required: true}
}, {_id: false});

const disputeDetailsSchema = new Schema({
    escalatedAt: {type: String, required: true},
    caseId: {type: String, required: true}
}, {_id: false});


const orderSchema = new Schema<IOrderDocument>(
    {
        _id: {
            type: String,
            default: () => uuidv4(),
            required: true
        },
        invoiceId: {type: String, required: true},

        // References
        gigId: {type: String, required: true, index: true},
        buyerId: {type: String, required: true, index: true},
        sellerId: {type: String, required: true, index: true},

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
        currency: {type: String, required: true, default: 'USD'},
        quantity: {type: Number, required: true},
        price: {type: Number, required: true},
        serviceFee: {type: Number, required: true},
        totalAmount: {type: Number, required: true},

        // Business logic fields (system controlled)
        status: {
            type: String,
            enum: [...Object.values(OrderStatus)],
            default: OrderStatus.PENDING
        },
        requirements: {type: [orderRequirementSchema], default: []},
        isCustomOffer: {type: Boolean, default: false},
        approvedAt: {type: String},

        revisionCount: {type: Number, required: true, default: 0},
        maxRevision: {type: Number, nullable: true, default: null},
        deliveredWork: {type: [deliveredWorkSchema], default: []},

        dateOrdered: {type: String, default: () => new Date().toISOString(), required: true},
        dueDate: {type: String, default: null},
        expectedDeliveryDate: {type: String, default: null},
        expectedDeliveryDays: {type: Number, required: true},

        // 1. Quản lý Đồng hồ Thời gian Bị Dừng
        // Lưu số phút còn lại khi trạng thái chuyển sang tạm dừng (CANCEL_PENDING, DISPUTED)
        timeRemainingBeforePause: {type: Number, default: null},

        // 2. Quản lý Đàm phán
        // ID của yêu cầu Negotiation đang chờ xử lý (tham chiếu đến NegotiationModel)
        currentNegotiationId: {type: String, default: null, ref: 'negotiations'},

        // 3. Chi tiết Giải quyết
        cancellationDetails: {type: cancellationDetailsSchema, default: null},
        disputeDetails: {type: disputeDetailsSchema, default: null},


        events: {type: [orderEventSchema], default: []},

        buyerReview: {type: orderReviewSchema, default: null},
        sellerReview: {type: orderReviewSchema, default: null}
    },
    {timestamps: true, versionKey: false}
);

orderSchema.virtual('negotiation', {
    ref: 'negotiations',
    localField: 'currentNegotiationId',
    foreignField: '_id',
    justOne: true,
});

export const OrderModel = model<IOrderDocument>('orders', orderSchema);
