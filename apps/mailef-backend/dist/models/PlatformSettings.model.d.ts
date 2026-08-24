import mongoose from "mongoose";
export interface IPlatformSettings extends mongoose.Document {
    singletonKey: string;
    mailProvider?: "ses" | "smtp";
    mailDefaultFromName?: string;
    mailVerifiedFromEmail?: string;
    mailConfigurationSetName?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUsername?: string;
    smtpPassword?: string;
    smtpSecure?: boolean;
    smtpTlsRejectUnauthorized?: boolean;
    dispatchEnabled?: boolean;
    dispatchIntervalMs?: number;
    dispatchUsersPerTick?: number;
    dispatchMaxPerRun?: number;
    workerConcurrency?: number;
    workerRateLimitMax?: number;
    workerRateLimitDurationMs?: number;
    customIntervalMinutes?: number;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<IPlatformSettings, {}, {}, {}, mongoose.Document<unknown, {}, IPlatformSettings, {}, mongoose.DefaultSchemaOptions> & IPlatformSettings & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, IPlatformSettings>;
export default _default;
//# sourceMappingURL=PlatformSettings.model.d.ts.map