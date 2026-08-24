export interface RuntimeSmtpRelay {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    password: string;
    secure: boolean;
    tlsRejectUnauthorized: boolean;
    isActive: boolean;
    isArchived: boolean;
    weight: number;
    sentToday: number;
    usageDate: string;
    lastUsedAt: Date | null;
    notes: string;
    healthStatus: "unknown" | "healthy" | "degraded" | "down";
    consecutiveFailures: number;
    lastHealthCheckAt: Date | null;
}
export interface UpdatableSmtpRelayInput {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    secure?: boolean;
    tlsRejectUnauthorized?: boolean;
    isActive?: boolean;
    isArchived?: boolean;
    weight?: number;
    notes?: string;
}
export interface AdminSmtpRelayRow {
    _id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    secure: boolean;
    tlsRejectUnauthorized: boolean;
    isActive: boolean;
    isArchived: boolean;
    weight: number;
    sentToday: number;
    lastUsedAt?: string;
    notes: string;
    passwordConfigured: boolean;
    healthStatus: "unknown" | "healthy" | "degraded" | "down";
    consecutiveFailures: number;
    lastHealthCheckAt?: string;
}
export declare const toAdminSmtpRelayRow: (relay: RuntimeSmtpRelay) => AdminSmtpRelayRow;
export declare const listAdminSmtpRelays: () => Promise<AdminSmtpRelayRow[]>;
export declare const getActiveSmtpRelays: (userId?: string | null) => Promise<RuntimeSmtpRelay[]>;
export declare const createSmtpRelay: (input: UpdatableSmtpRelayInput) => Promise<AdminSmtpRelayRow>;
export declare const updateSmtpRelay: (id: string, input: UpdatableSmtpRelayInput) => Promise<AdminSmtpRelayRow | null>;
export declare const setSmtpRelayActiveState: (id: string, isActive: boolean) => Promise<AdminSmtpRelayRow | null>;
export declare const setSmtpRelayArchivedState: (id: string, isArchived: boolean) => Promise<AdminSmtpRelayRow | null>;
export declare const deleteSmtpRelay: (id: string) => Promise<boolean>;
export declare const markSmtpRelayUsed: (id: string) => Promise<void>;
//# sourceMappingURL=smtp-relay.service.d.ts.map