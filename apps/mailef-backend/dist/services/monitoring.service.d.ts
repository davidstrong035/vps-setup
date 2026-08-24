export interface SystemHealthStatus {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    database: {
        connected: boolean;
    };
    redis: {
        connected: boolean;
    };
    smtpRelays: {
        total: number;
        healthy: number;
        degraded: number;
        down: number;
        autoDeactivated: number;
    };
    queues: {
        pending: number;
        deadLetter: number;
    };
    campaigns: {
        stuck: number;
        sending: number;
        paused: number;
        total: number;
    };
    globalQuota: {
        perMinute: {
            used: number;
            limit: number | undefined;
        } | null;
        perHour: {
            used: number;
            limit: number | undefined;
        } | null;
        perDay: {
            used: number;
            limit: number | undefined;
        } | null;
    } | null;
    alerts: string[];
}
declare const buildHealthStatus: () => Promise<SystemHealthStatus>;
export { buildHealthStatus };
export declare const startMonitoring: () => void;
export declare const stopMonitoring: () => void;
//# sourceMappingURL=monitoring.service.d.ts.map