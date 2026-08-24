"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNextSendingDomain = getNextSendingDomain;
const User_model_1 = __importDefault(require("../models/User.model"));
const SendingDomain_model_1 = require("../models/SendingDomain.model");
const domain_rotation_1 = require("../config/domain-rotation");
const smtp_relay_service_1 = require("./smtp-relay.service");
/**
 * Returns the next domain to use for sending for a user, rotating through their active & verified domains.
 * Rotation is round-robin based on perDomainBatchSize (user or global default).
 * Only considers domains compatible with the user's available relays (VPS).
 */
async function getNextSendingDomain(userId) {
    // Get assigned domain IDs, batch size, and current rotation index for the user
    const user = await User_model_1.default.findById(userId).select("assignedDomainIds perDomainBatchSize domainRotationIndex").lean();
    if (!user || !user.assignedDomainIds || user.assignedDomainIds.length === 0)
        return null;
    const batchSize = user.perDomainBatchSize || domain_rotation_1.DEFAULT_PER_DOMAIN_BATCH_SIZE;
    // Get all active & verified domains assigned to the user
    const domains = await SendingDomain_model_1.SendingDomain.find({
        _id: { $in: user.assignedDomainIds },
        isActive: true,
        verificationStatus: "verified",
    })
        .select("domain usedToday updatedAt createdAt smtpRelayIds")
        .lean();
    // Debug logging for eligibility
    const relays = await (0, smtp_relay_service_1.getActiveSmtpRelays)(userId);
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
    const isDomainCompatibleWithRelays = (domain, activeRelayIds) => {
        const mappedRelayIds = Array.isArray(domain.smtpRelayIds)
            ? domain.smtpRelayIds.map(String).filter(Boolean)
            : [];
        if (mappedRelayIds.length === 0 || activeRelayIds.length === 0)
            return true;
        return mappedRelayIds.some((relayId) => activeRelayIds.includes(relayId));
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
    await User_model_1.default.findByIdAndUpdate(userId, { domainRotationIndex: nextIndex }, { new: false });
    console.info("[DomainRotation] Selected domain:", selectedDomain.domain, `(index ${currentIndex}/${compatibleDomains.length})`);
    return selectedDomain.domain;
}
//# sourceMappingURL=domain-rotation.service.js.map