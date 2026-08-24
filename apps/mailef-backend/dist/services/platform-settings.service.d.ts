export interface RuntimeMailSettings {
    provider: "ses" | "smtp";
    defaultFromName: string;
    verifiedFromEmail: string;
    configurationSetName: string;
    smtpHost: string;
    smtpPort: number;
    smtpUsername: string;
    smtpPassword: string;
    smtpSecure: boolean;
    smtpTlsRejectUnauthorized: boolean;
}
export interface UpdatableMailSettings {
    provider?: "ses" | "smtp";
    defaultFromName?: string;
    verifiedFromEmail?: string;
    configurationSetName?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUsername?: string;
    smtpPassword?: string;
    smtpSecure?: boolean;
    smtpTlsRejectUnauthorized?: boolean;
}
export interface AdminMailSettings extends Omit<RuntimeMailSettings, "smtpPassword"> {
    smtpPasswordConfigured: boolean;
}
export interface RuntimeDispatchSettings {
    enabled: boolean;
    intervalMs: number;
    usersPerTick: number;
    maxPerRun: number;
    workerConcurrency: number;
    workerRateLimitMax: number;
    workerRateLimitDurationMs: number;
    customIntervalMinutes?: number;
}
export interface UpdatableDispatchSettings {
    enabled?: boolean;
    intervalMs?: number;
    usersPerTick?: number;
    maxPerRun?: number;
    workerConcurrency?: number;
    workerRateLimitMax?: number;
    workerRateLimitDurationMs?: number;
    customIntervalMinutes?: number;
}
export declare const toAdminMailSettings: (mailSettings: RuntimeMailSettings) => AdminMailSettings;
export declare const clearPlatformMailSettingsCache: () => void;
export declare const getPlatformMailSettings: () => Promise<RuntimeMailSettings>;
export declare const updatePlatformMailSettings: (input: UpdatableMailSettings) => Promise<RuntimeMailSettings>;
export declare const getPlatformDispatchSettings: () => Promise<RuntimeDispatchSettings>;
export declare const updatePlatformDispatchSettings: (input: UpdatableDispatchSettings) => Promise<RuntimeDispatchSettings>;
//# sourceMappingURL=platform-settings.service.d.ts.map