import { SendRateLimits } from "./rate-limit.service";
export interface QuotaReservationLimits {
    globalLimits: SendRateLimits;
    effectiveUserLimits: SendRateLimits;
}
export declare const reserveDispatchQuota: (userId: string, requested: number, limits: QuotaReservationLimits) => Promise<number>;
//# sourceMappingURL=quota-reservation.service.d.ts.map