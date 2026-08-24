"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEligibleSendingDomains = getEligibleSendingDomains;
exports.getAvailableSendingDomainNames = getAvailableSendingDomainNames;
exports.getMappedSmtpRelayIdsForDomain = getMappedSmtpRelayIdsForDomain;
exports.getVerifiedDomainForRelay = getVerifiedDomainForRelay;
exports.isSendingDomainEligible = isSendingDomainEligible;
exports.selectSendingDomain = selectSendingDomain;
const SendingDomain_model_1 = require("../models/SendingDomain.model");
const User_model_1 = __importDefault(require("../models/User.model"));
const smtp_relay_service_1 = require("./smtp-relay.service");
const mongoose_1 = require("mongoose");
const buildEligibleDomainQuery = (now = new Date()) => ({
    isActive: true,
    blocklisted: { $ne: true },
    verificationStatus: 'verified',
    $and: [
        {
            $or: [{ cooldownUntil: { $exists: false } }, { cooldownUntil: { $lte: now } }],
        },
        {
            $or: [
                { dailyQuota: { $exists: false } },
                { dailyQuota: null },
                { $expr: { $lt: ['$usedToday', '$dailyQuota'] } },
            ],
        },
    ],
});
const normalizeRelayIds = (relayIds) => Array.from(new Set((relayIds || [])
    .map((relayId) => String(relayId || '').trim())
    .filter(Boolean)));
const isDomainCompatibleWithRelays = (domain, activeRelayIds) => {
    const mappedRelayIds = normalizeRelayIds((domain.smtpRelayIds || []));
    if (mappedRelayIds.length === 0 || activeRelayIds.length === 0) {
        return true;
    }
    return mappedRelayIds.some((relayId) => activeRelayIds.includes(relayId));
};
const resolveActiveRelayIds = async (userId) => {
    try {
        const relays = await (0, smtp_relay_service_1.getActiveSmtpRelays)(userId);
        return relays.map((relay) => relay.id).filter(Boolean);
    }
    catch {
        return [];
    }
};
async function getEligibleSendingDomains(options = {}) {
    const baseQuery = buildEligibleDomainQuery();
    const userQuery = options.userId
        ? { ...baseQuery, userId: options.userId }
        : { ...baseQuery, userId: null };
    const domains = await SendingDomain_model_1.SendingDomain.find(userQuery).sort({
        usedToday: 1,
        reputationScore: -1,
        isDefault: -1,
        domain: 1,
    });
    const activeRelayIds = options.activeRelayIds || (await resolveActiveRelayIds(options.userId));
    return domains.filter((domain) => isDomainCompatibleWithRelays(domain, activeRelayIds));
}
async function getAvailableSendingDomainNames() {
    const domains = await getEligibleSendingDomains();
    return {
        domains: domains.map((domain) => domain.domain),
        defaultDomain: domains.find((domain) => domain.isDefault)?.domain || null,
    };
}
async function getMappedSmtpRelayIdsForDomain(domain) {
    const normalizedDomain = String(domain || '').trim().toLowerCase();
    if (!normalizedDomain)
        return null;
    const record = await SendingDomain_model_1.SendingDomain.findOne({ domain: normalizedDomain })
        .select('smtpRelayIds')
        .lean();
    const relayIds = normalizeRelayIds((record?.smtpRelayIds || []));
    return relayIds.length > 0 ? relayIds : null;
}
async function getVerifiedDomainForRelay(relayId, userId) {
    let assignedIds = [];
    if (userId) {
        const userRecord = await User_model_1.default.findById(userId).select('assignedDomainIds').lean();
        assignedIds = (userRecord?.assignedDomainIds || []).map((id) => id.toString());
    }
    // Build a filter that only returns domains the user is allowed to send from
    const ownershipFilter = userId
        ? {
            $or: [
                { userId: new mongoose_1.Types.ObjectId(userId) },
                ...(assignedIds.length > 0
                    ? [{ userId: null, _id: { $in: assignedIds.map((id) => new mongoose_1.Types.ObjectId(id)) } }]
                    : []),
            ],
        }
        : { userId: null };
    const domain = await SendingDomain_model_1.SendingDomain.findOne({
        smtpRelayIds: new mongoose_1.Types.ObjectId(relayId),
        verificationStatus: 'verified',
        isActive: true,
        ...ownershipFilter,
    })
        .select('domain')
        .lean();
    return domain?.domain || null;
}
async function isSendingDomainEligible(domain, userId) {
    const normalizedDomain = String(domain || '').trim().toLowerCase();
    if (!normalizedDomain)
        return false;
    // Check user-owned domain first
    if (userId) {
        const userMatch = await SendingDomain_model_1.SendingDomain.findOne({
            domain: normalizedDomain,
            userId,
            ...buildEligibleDomainQuery(),
        }).select('_id smtpRelayIds').lean();
        if (userMatch) {
            const activeRelayIds = await resolveActiveRelayIds(userId);
            return isDomainCompatibleWithRelays(userMatch, activeRelayIds);
        }
        // Check platform domain assigned to this user
        const userRecord = await User_model_1.default.findById(userId).select('assignedDomainIds').lean();
        const assignedIds = (userRecord?.assignedDomainIds || []).map((id) => id.toString());
        if (assignedIds.length > 0) {
            const platformMatch = await SendingDomain_model_1.SendingDomain.findOne({
                domain: normalizedDomain,
                userId: null,
                _id: { $in: assignedIds },
                ...buildEligibleDomainQuery(),
            }).select('_id smtpRelayIds').lean();
            if (platformMatch) {
                const activeRelayIds = await resolveActiveRelayIds(userId);
                return isDomainCompatibleWithRelays(platformMatch, activeRelayIds);
            }
        }
        return false;
    }
    // No userId — check platform domains only
    const match = await SendingDomain_model_1.SendingDomain.findOne({
        domain: normalizedDomain,
        userId: null,
        ...buildEligibleDomainQuery(),
    }).select('_id smtpRelayIds').lean();
    if (!match)
        return false;
    const activeRelayIds = await resolveActiveRelayIds(null);
    return isDomainCompatibleWithRelays(match, activeRelayIds);
}
async function selectSendingDomain(preferredDomain, userId) {
    // If user has assigned platform domains, restrict selection to those.
    let assignedDomainIds = [];
    if (userId) {
        const userRecord = await User_model_1.default.findById(userId).select('assignedDomainIds').lean();
        assignedDomainIds = (userRecord?.assignedDomainIds || []).map((id) => id.toString());
    }
    // Try user-owned domains first, fall back to platform domains (optionally filtered by assignment).
    let domains = userId ? await getEligibleSendingDomains({ userId }) : [];
    if (!domains.length) {
        let platformDomains = await getEligibleSendingDomains({ userId: null });
        if (assignedDomainIds.length > 0) {
            platformDomains = platformDomains.filter((d) => assignedDomainIds.includes(d._id.toString()));
        }
        domains = platformDomains;
    }
    if (!domains.length)
        return null;
    const normalizedPreferredDomain = String(preferredDomain || '').trim().toLowerCase();
    if (normalizedPreferredDomain) {
        const preferred = domains.find((domain) => domain.domain === normalizedPreferredDomain);
        if (preferred) {
            return preferred.domain;
        }
    }
    return domains[0].domain;
}
//# sourceMappingURL=sending-domain.service.js.map