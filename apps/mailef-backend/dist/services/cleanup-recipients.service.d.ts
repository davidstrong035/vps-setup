/**
 * Deletes all CampaignRecipient records for a given campaign.
 * This is called when a campaign reaches "sent" status to free up MongoDB storage.
 *
 * The campaign's aggregated stats (stats.sent, stats.failed, stats.total)
 * are preserved on the Campaign document itself.
 * Failed email details are preserved in the BullMQ dead letter queue (Redis).
 */
export declare function cleanupCampaignRecipients(campaignId: string): Promise<void>;
//# sourceMappingURL=cleanup-recipients.service.d.ts.map