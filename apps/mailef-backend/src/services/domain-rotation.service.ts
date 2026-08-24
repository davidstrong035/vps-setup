import { Types } from "mongoose";
import User from "../models/User.model";
import { SendingDomain } from "../models/SendingDomain.model";
import CampaignRecipient from "../models/CampaignRecipient.model";
import { DEFAULT_PER_DOMAIN_BATCH_SIZE } from "../config/domain-rotation";
import { getActiveSmtpRelays } from "./smtp-relay.service";

/**
 * Returns the next domain to use for sending for a user, rotating through their active & verified domains.
 * Rotation is round-robin based on perDomainBatchSize (user or global default).
 * Only considers domains compatible with the user's available relays (VPS).
 */
export async function getNextSendingDomain(userId: string): Promise<string | null> {
  // Get assigned domain IDs, batch size, and current rotation index for the user
  const user = await User.findById(userId).select("assignedDomainIds perDomainBatchSize domainRotationIndex").lean();
  if (!user || !user.assignedDomainIds || user.assignedDomainIds.length === 0) return null;
  const batchSize = user.perDomainBatchSize || DEFAULT_PER_DOMAIN_BATCH_SIZE;

  // Get all active & verified domains assigned to the user
  const domains = await SendingDomain.find({
    _id: { $in: user.assignedDomainIds },
    isActive: true,
    verificationStatus: "verified",
  })
    .select("domain usedToday updatedAt createdAt smtpRelayIds")
    .lean();

  // Debug logging for eligibility
  const relays = await getActiveSmtpRelays(userId);
  const relayIds = relays.map(r => r.id);
  console.info("[DomainRotation] User:", userId);
  console.info("[DomainRotation] Assigned domains:", domains.map(d => ({ domain: d.domain, relays: d.smtpRelayIds })));
  console.info("[DomainRotation] Active relays:", relayIds);
  if (!domains.length) {
    console.warn("[DomainRotation] No assigned domains found for user.");
    return null;
  }
  if (!relayIds.length) {
    console.warn("[DomainRotation] No active relays found for user.");
  }

  // Helper: check if domain is compatible with available relays
  const isDomainCompatibleWithRelays = (domain: any, activeRelayIds: string[]) => {
    const mappedRelayIds = Array.isArray(domain.smtpRelayIds)
      ? domain.smtpRelayIds.map(String).filter(Boolean)
      : [];
    if (mappedRelayIds.length === 0 || activeRelayIds.length === 0) return true;
    return mappedRelayIds.some((relayId: any) => activeRelayIds.includes(relayId));
  };

  // Filter domains to only those compatible with available relays
  const compatibleDomains = domains.filter(domain => isDomainCompatibleWithRelays(domain, relayIds));
  if (!compatibleDomains.length) {
    console.warn("[DomainRotation] No compatible domains found. Reasons:");
    domains.forEach(domain => {
      const mappedRelayIds = Array.isArray(domain.smtpRelayIds)
        ? domain.smtpRelayIds.map(String).filter(Boolean)
        : [];
      if (mappedRelayIds.length && !mappedRelayIds.some(relayId => relayIds.includes(relayId))) {
        console.warn(`- Domain ${domain.domain} mapped to relays [${mappedRelayIds.join(", ")}] but none are active for user.`);
      }
    });
    return null;
  }

  // Round-robin rotation: pick the next domain based on rotation index
  const currentIndex = (user.domainRotationIndex || 0) % compatibleDomains.length;
  const selectedDomain = compatibleDomains[currentIndex];
  
  // Increment rotation index for next call
  const nextIndex = (currentIndex + 1) % compatibleDomains.length;
  await User.findByIdAndUpdate(userId, { domainRotationIndex: nextIndex }, { new: false });

  console.info(
    "[DomainRotation] Selected domain:",
    selectedDomain.domain,
    `(index ${currentIndex}/${compatibleDomains.length})`
  );
  return selectedDomain.domain;
}
