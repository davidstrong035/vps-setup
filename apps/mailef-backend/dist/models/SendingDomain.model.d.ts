import { Schema, Document, Types } from 'mongoose';
export interface ISendingDomain extends Document {
    userId?: Types.ObjectId;
    bounceCount?: number;
    complaintCount?: number;
    lastBounceAt?: Date;
    lastComplaintAt?: Date;
    blocklisted?: boolean;
    cooldownUntil?: Date;
    verificationStatus?: 'pending' | 'verified' | 'failed';
    domain: string;
    dkimSelector?: string;
    dkimPublicKey?: string;
    spfRecord?: string;
    isActive: boolean;
    isDefault?: boolean;
    reputationScore?: number;
    dailyQuota?: number;
    usedToday?: number;
    notes?: string;
    smtpRelayIds?: Schema.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
}
export declare const SendingDomain: import("mongoose").Model<ISendingDomain, {}, {}, {}, Document<unknown, {}, ISendingDomain, {}, import("mongoose").DefaultSchemaOptions> & ISendingDomain & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, ISendingDomain>;
//# sourceMappingURL=SendingDomain.model.d.ts.map