"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.markSmtpRelayUsed = exports.deleteSmtpRelay = exports.setSmtpRelayArchivedState = exports.setSmtpRelayActiveState = exports.updateSmtpRelay = exports.createSmtpRelay = exports.getActiveSmtpRelays = exports.listAdminSmtpRelays = exports.toAdminSmtpRelayRow = void 0;
const SmtpRelay_model_1 = __importDefault(require("../models/SmtpRelay.model"));
const getTodayKey = () => new Date().toISOString().slice(0, 10);
const normalizeRelay = (relay) => {
    const port = Math.max(Number(relay?.port) || 587, 1);
    return {
        id: relay?._id?.toString() || "",
        name: relay?.name?.trim() || "",
        host: relay?.host?.trim().toLowerCase() || "",
        port,
        username: relay?.username?.trim() || "",
        password: relay?.password || "",
        secure: typeof relay?.secure === "boolean" ? relay.secure : port === 465,
        tlsRejectUnauthorized: relay?.tlsRejectUnauthorized !== false,
        isActive: relay?.isActive !== false,
        isArchived: Boolean(relay?.isArchived),
        weight: Math.max(Number(relay?.weight) || 1, 1),
        sentToday: Math.max(Number(relay?.sentToday) || 0, 0),
        usageDate: relay?.usageDate?.trim() || getTodayKey(),
        lastUsedAt: relay?.lastUsedAt ? new Date(relay.lastUsedAt) : null,
        notes: relay?.notes?.trim() || "",
        healthStatus: relay?.healthStatus || "unknown",
        consecutiveFailures: Math.max(Number(relay?.consecutiveFailures) || 0, 0),
        lastHealthCheckAt: relay?.lastHealthCheckAt ? new Date(relay.lastHealthCheckAt) : null,
    };
};
const toAdminSmtpRelayRow = (relay) => ({
    _id: relay.id,
    name: relay.name,
    host: relay.host,
    port: relay.port,
    username: relay.username,
    secure: relay.secure,
    tlsRejectUnauthorized: relay.tlsRejectUnauthorized,
    isActive: relay.isActive,
    isArchived: relay.isArchived,
    weight: relay.weight,
    sentToday: relay.sentToday,
    lastUsedAt: relay.lastUsedAt ? relay.lastUsedAt.toISOString() : undefined,
    notes: relay.notes,
    passwordConfigured: Boolean(relay.password),
    healthStatus: relay.healthStatus,
    consecutiveFailures: relay.consecutiveFailures,
    lastHealthCheckAt: relay.lastHealthCheckAt ? relay.lastHealthCheckAt.toISOString() : undefined,
});
exports.toAdminSmtpRelayRow = toAdminSmtpRelayRow;
const resetDailyRelayUsageIfNeeded = async () => {
    const today = getTodayKey();
    await SmtpRelay_model_1.default.updateMany({
        $or: [{ usageDate: { $ne: today } }, { usageDate: { $exists: false } }],
    }, {
        $set: {
            sentToday: 0,
            usageDate: today,
        },
    });
};
const listAdminSmtpRelays = async () => {
    await resetDailyRelayUsageIfNeeded();
    const relays = await SmtpRelay_model_1.default.find()
        .sort({ isArchived: 1, isActive: -1, weight: -1, name: 1 })
        .lean();
    return relays.map((relay) => (0, exports.toAdminSmtpRelayRow)(normalizeRelay(relay)));
};
exports.listAdminSmtpRelays = listAdminSmtpRelays;
const getActiveSmtpRelays = async (userId) => {
    await resetDailyRelayUsageIfNeeded();
    const userRelays = userId
        ? await SmtpRelay_model_1.default.find({ isActive: true, isArchived: { $ne: true }, userId }).lean()
        : [];
    if (userRelays.length > 0) {
        return userRelays.map((relay) => normalizeRelay(relay));
    }
    const relays = await SmtpRelay_model_1.default.find({ isActive: true, isArchived: { $ne: true }, userId: null }).lean();
    return relays
        .map((relay) => normalizeRelay(relay))
        .sort((a, b) => {
        const aLoad = a.sentToday / Math.max(a.weight, 1);
        const bLoad = b.sentToday / Math.max(b.weight, 1);
        return (aLoad - bLoad ||
            (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0) ||
            b.weight - a.weight ||
            a.name.localeCompare(b.name));
    });
};
exports.getActiveSmtpRelays = getActiveSmtpRelays;
const createSmtpRelay = async (input) => {
    const relay = await SmtpRelay_model_1.default.create({
        name: input.name?.trim(),
        host: input.host?.trim().toLowerCase(),
        port: Math.max(Math.floor(Number(input.port) || 587), 1),
        username: input.username?.trim() || undefined,
        password: input.password?.trim() || undefined,
        secure: typeof input.secure === "boolean" ? input.secure : false,
        tlsRejectUnauthorized: typeof input.tlsRejectUnauthorized === "boolean"
            ? input.tlsRejectUnauthorized
            : true,
        isActive: typeof input.isActive === "boolean" ? input.isActive : true,
        isArchived: typeof input.isArchived === "boolean" ? input.isArchived : false,
        weight: Math.max(Math.floor(Number(input.weight) || 1), 1),
        notes: input.notes?.trim() || undefined,
        sentToday: 0,
        usageDate: getTodayKey(),
    });
    return (0, exports.toAdminSmtpRelayRow)(normalizeRelay(relay.toObject()));
};
exports.createSmtpRelay = createSmtpRelay;
const updateSmtpRelay = async (id, input) => {
    const existing = await SmtpRelay_model_1.default.findById(id);
    if (!existing) {
        return null;
    }
    if (input.name !== undefined)
        existing.name = input.name.trim() || existing.name;
    if (input.host !== undefined) {
        existing.host = input.host.trim().toLowerCase() || existing.host;
    }
    if (input.port !== undefined) {
        existing.port = Math.max(Math.floor(Number(input.port) || existing.port), 1);
    }
    if (input.username !== undefined) {
        existing.username = input.username.trim() || undefined;
    }
    if (input.password !== undefined) {
        existing.password = input.password.trim() || existing.password || undefined;
    }
    if (typeof input.secure === "boolean")
        existing.secure = input.secure;
    if (typeof input.tlsRejectUnauthorized === "boolean") {
        existing.tlsRejectUnauthorized = input.tlsRejectUnauthorized;
    }
    if (typeof input.isActive === "boolean")
        existing.isActive = input.isActive;
    if (typeof input.isArchived === "boolean")
        existing.isArchived = input.isArchived;
    if (input.weight !== undefined) {
        existing.weight = Math.max(Math.floor(Number(input.weight) || existing.weight), 1);
    }
    if (input.notes !== undefined) {
        existing.notes = input.notes.trim() || undefined;
    }
    await existing.save();
    return (0, exports.toAdminSmtpRelayRow)(normalizeRelay(existing.toObject()));
};
exports.updateSmtpRelay = updateSmtpRelay;
const setSmtpRelayActiveState = async (id, isActive) => {
    const relay = await SmtpRelay_model_1.default.findByIdAndUpdate(id, { isActive }, {
        returnDocument: "after",
    }).lean();
    return relay ? (0, exports.toAdminSmtpRelayRow)(normalizeRelay(relay)) : null;
};
exports.setSmtpRelayActiveState = setSmtpRelayActiveState;
const setSmtpRelayArchivedState = async (id, isArchived) => {
    const relay = await SmtpRelay_model_1.default.findByIdAndUpdate(id, { isArchived }, {
        returnDocument: "after",
    }).lean();
    return relay ? (0, exports.toAdminSmtpRelayRow)(normalizeRelay(relay)) : null;
};
exports.setSmtpRelayArchivedState = setSmtpRelayArchivedState;
const deleteSmtpRelay = async (id) => {
    const result = await SmtpRelay_model_1.default.findByIdAndDelete(id).lean();
    return Boolean(result);
};
exports.deleteSmtpRelay = deleteSmtpRelay;
const markSmtpRelayUsed = async (id) => {
    await SmtpRelay_model_1.default.findByIdAndUpdate(id, {
        $inc: { sentToday: 1 },
        $set: { lastUsedAt: new Date(), usageDate: getTodayKey() },
    }).catch(() => undefined);
};
exports.markSmtpRelayUsed = markSmtpRelayUsed;
//# sourceMappingURL=smtp-relay.service.js.map