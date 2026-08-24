/**
 * Returns the next domain to use for sending for a user, rotating through their active & verified domains.
 * Rotation is round-robin based on perDomainBatchSize (user or global default).
 * Only considers domains compatible with the user's available relays (VPS).
 */
export declare function getNextSendingDomain(userId: string): Promise<string | null>;
//# sourceMappingURL=domain-rotation.service.d.ts.map