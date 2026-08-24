import { Schema, model, Document, Types } from 'mongoose';

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

const SendingDomainSchema = new Schema<ISendingDomain>(
  {
    bounceCount: { type: Number, default: 0 },
    complaintCount: { type: Number, default: 0 },
    lastBounceAt: { type: Date },
    lastComplaintAt: { type: Date },
    blocklisted: { type: Boolean, default: false },
    cooldownUntil: { type: Date },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'failed'],
      default: 'pending',
    },
    domain: { type: String, required: true, unique: true, trim: true, lowercase: true },
    dkimSelector: { type: String },
    dkimPublicKey: { type: String },
    spfRecord: { type: String },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    reputationScore: { type: Number, default: 100 },
    dailyQuota: { type: Number },
    usedToday: { type: Number, default: 0 },
    notes: { type: String },
    smtpRelayIds: [{ type: Schema.Types.ObjectId, ref: 'SmtpRelay' }],
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
  },
  {
    timestamps: true,
  }
);

export const SendingDomain = model<ISendingDomain>('SendingDomain', SendingDomainSchema);
