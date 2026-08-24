export interface SendRateLimits {
    perMinute?: number;
    perHour?: number;
    perDay?: number;
}
interface WindowCountResult {
    perMinuteSent: number;
    perHourSent: number;
    perDaySent: number;
}
export declare const normalizeRateLimits: (payload: Record<string, unknown>) => SendRateLimits;
export declare const getGlobalRateLimits: () => Promise<SendRateLimits>;
export declare const getUserRateLimits: (userId: string) => Promise<SendRateLimits>;
export declare const getEffectiveRateLimits: (userId: string) => Promise<{
    globalLimits: SendRateLimits;
    userLimits: SendRateLimits;
    effectiveLimits: SendRateLimits;
}>;
export declare const getRemainingSendAllowance: (userId: string) => Promise<{
    remaining: number | null;
    effectiveLimits: SendRateLimits;
    sentInWindows: WindowCountResult;
}>;
export declare const upsertGlobalRateLimits: (limits: SendRateLimits) => Promise<SendRateLimits>;
export declare const upsertUserRateLimits: (userId: string, limits: SendRateLimits) => Promise<SendRateLimits>;
export {};
//# sourceMappingURL=rate-limit.service.d.ts.map