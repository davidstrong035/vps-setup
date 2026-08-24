/**
 * Requeue failed/stuck campaign recipients.
 *
 * Usage:
 *   npx ts-node src/scripts/requeue-failed-campaign.ts <campaignId>
 *   npx ts-node src/scripts/requeue-failed-campaign.ts <campaignId> --flush-quota
 *
 * What it does:
 *   1. Obliterates all failed/stalled BullMQ jobs for the campaign
 *   2. Resets failed + queued recipients back to pending
 *   3. Resets campaign stats (sent/failed) to match reality
 *   4. Optionally flushes Redis quota keys so rate limits don't block the retry
 */
export {};
//# sourceMappingURL=requeue-failed-campaign.d.ts.map