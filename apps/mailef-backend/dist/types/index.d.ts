import { Request } from "express";
import { Document, Types } from "mongoose";
export interface IUser extends Document {
    _id: Types.ObjectId;
    name: string;
    email: string;
    password: string;
    role: "user" | "admin" | "super_admin";
    isActive: boolean;
    assignedDomainIds?: Types.ObjectId[];
    perDomainBatchSize?: number;
    domainRotationIndex?: number;
    passwordResetToken?: string | null;
    passwordResetExpires?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    comparePassword(candidatePassword: string): Promise<boolean>;
}
export interface IList extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    name: string;
    description?: string;
    subscriberCount: number;
    storageType?: "mongo" | "s3";
    importStatus?: "empty" | "ready" | "processing" | "failed";
    sourceOriginalFileName?: string;
    s3UploadKey?: string;
    s3ManifestKey?: string;
    s3ChunkCount?: number;
    previewRows?: Array<{
        email: string;
        firstName?: string;
        lastName?: string;
    }>;
    createdAt: Date;
    updatedAt: Date;
}
export interface ISubscriber extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    listId: Types.ObjectId;
    email: string;
    firstName?: string;
    lastName?: string;
    status: "active" | "unsubscribed" | "bounced" | "complained";
    customFields?: Record<string, string>;
    createdAt: Date;
    updatedAt: Date;
}
export interface ITemplate extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    name: string;
    subject: string;
    html: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface ICampaign extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    name: string;
    subject: string;
    fromName: string;
    fromEmail: string;
    sendingDomain?: string;
    listId: Types.ObjectId;
    templateId?: Types.ObjectId;
    html: string;
    status: "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled";
    pauseReason?: string;
    pausedBy?: "user" | "admin" | "system";
    scheduledAt?: Date;
    sentAt?: Date;
    dispatchCursorChunkIndex?: number;
    dispatchCursorRowOffset?: number;
    stats: {
        total: number;
        sent: number;
        failed: number;
        opened: number;
        clicked: number;
        bounced: number;
        complained: number;
        unsubscribed: number;
    };
    createdAt: Date;
    updatedAt: Date;
}
export interface AuthRequest extends Request {
    userId?: string;
    userRole?: "user" | "admin" | "super_admin";
    requestId?: string;
    requestIp?: string;
    requestUserAgent?: string;
}
export interface ICampaignRecipient extends Document {
    _id: Types.ObjectId;
    campaignId: Types.ObjectId;
    userId: Types.ObjectId;
    listId: Types.ObjectId;
    subscriberId?: Types.ObjectId;
    email: string;
    status: "pending" | "queued" | "sent" | "failed" | "bounced" | "complained";
    messageId?: string;
    retryCount: number;
    lastError?: string;
    sentAt?: Date;
    openedAt?: Date;
    clickedAt?: Date;
    bouncedAt?: Date;
    complainedAt?: Date;
    fromEmail?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface IWebhookEvent extends Document {
    _id: Types.ObjectId;
    source: "ses" | "postal";
    eventId: string;
    eventType?: string;
    rawPayload?: string;
    receivedAt: Date;
}
export interface IListSuppression extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    listId: Types.ObjectId;
    email: string;
    status: "unsubscribed" | "bounced" | "complained";
    source: "unsubscribe" | "ses_bounce" | "ses_complaint" | "postal_bounce" | "postal_complaint";
    createdAt: Date;
    updatedAt: Date;
}
export interface IRateLimitPolicy extends Document {
    _id: Types.ObjectId;
    scope: "global" | "user";
    userId?: Types.ObjectId;
    perMinute?: number;
    perHour?: number;
    perDay?: number;
    createdAt: Date;
    updatedAt: Date;
}
export interface IAuditLog extends Document {
    _id: Types.ObjectId;
    actorType: "system" | "user";
    actorId?: Types.ObjectId;
    actorRole?: "user" | "admin" | "super_admin";
    action: string;
    resourceType: string;
    resourceId?: string;
    targetUserId?: Types.ObjectId;
    status: "success" | "failure";
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface IEmailCreditAllocation extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    assignedByUserId: Types.ObjectId;
    amountPaid: number;
    currency: string;
    emailsPurchased: number;
    consumedEmails: number;
    reservedEmails: number;
    paidAt: Date;
    expiresAt: Date;
    receiptReference?: string;
    note?: string;
    status: "active" | "expired" | "consumed" | "superseded" | "suspended";
    createdAt: Date;
    updatedAt: Date;
}
export interface MailJobData {
    campaignId: string;
    campaignRecipientId: string;
    emailAllocationId?: string;
    subscriberId?: string;
    userId?: string;
    to: string;
    subject: string;
    html: string;
    fromName: string;
    fromEmail: string;
    messageId?: string;
}
//# sourceMappingURL=index.d.ts.map