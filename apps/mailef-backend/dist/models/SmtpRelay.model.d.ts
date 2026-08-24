import mongoose from "mongoose";
export interface ISmtpRelay extends mongoose.Document {
    userId?: mongoose.Types.ObjectId;
    name: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    secure?: boolean;
    tlsRejectUnauthorized?: boolean;
    isActive: boolean;
    isArchived: boolean;
    weight: number;
    sentToday: number;
    usageDate?: string;
    lastUsedAt?: Date;
    notes?: string;
    healthStatus: "unknown" | "healthy" | "degraded" | "down";
    consecutiveFailures: number;
    lastHealthCheckAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<ISmtpRelay, {}, {}, {}, mongoose.Document<unknown, {}, ISmtpRelay, {}, mongoose.DefaultSchemaOptions> & ISmtpRelay & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, ISmtpRelay>;
export default _default;
//# sourceMappingURL=SmtpRelay.model.d.ts.map