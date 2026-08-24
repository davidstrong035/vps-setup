import { ICampaign } from "../types";
/**
 * Pauses a campaign and cleans up the BullMQ queue + reserved credits so that
 * the allocation accurately reflects what has actually been sent.
 *
 * Without this, queued-but-unsent recipients keep `reservedEmails` inflated,
 * making the package look depleted even when very few emails have been sent.
 */
export declare const pauseCampaignAndReleaseQueue: (campaignId: string, pauseReason: string, pausedBy?: "user" | "admin" | "system") => Promise<void>;
export interface DispatchCampaignResult {
    totalActiveSubscribers: number;
    queued: number;
    remainingAllowance: number | null;
    rateLimited: boolean;
    creditLimited: boolean;
    hasActiveAllocation: boolean;
    alreadyCompleted: boolean;
}
interface DispatchCampaignOptions {
    retryFailedRecipients?: boolean;
}
export declare const dispatchCampaign: (campaign: ICampaign, options?: DispatchCampaignOptions) => Promise<DispatchCampaignResult>;
export {};
//# sourceMappingURL=campaign-dispatch.service.d.ts.map