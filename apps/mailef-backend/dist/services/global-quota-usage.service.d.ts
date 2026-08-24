export interface GlobalQuotaUsage {
    perMinute: {
        limit: number | undefined;
        used: number;
        remaining: number;
    };
    perHour: {
        limit: number | undefined;
        used: number;
        remaining: number;
    };
    perDay: {
        limit: number | undefined;
        used: number;
        remaining: number;
    };
}
export declare const getGlobalQuotaUsage: () => Promise<GlobalQuotaUsage>;
//# sourceMappingURL=global-quota-usage.service.d.ts.map