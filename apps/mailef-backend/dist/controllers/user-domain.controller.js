"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserSendTimes = exports.getUserNextSendTime = exports.linkRelayToDomain = exports.deleteUserRelay = exports.updateUserRelay = exports.createUserRelay = exports.listUserRelays = exports.setUserDefaultDomain = exports.deleteUserDomain = exports.createUserDomain = exports.listUserDomains = void 0;
const mongoose_1 = require("mongoose");
const SendingDomain_model_1 = require("../models/SendingDomain.model");
const SmtpRelay_model_1 = __importDefault(require("../models/SmtpRelay.model"));
const User_model_1 = __importDefault(require("../models/User.model"));
const next_send_time_service_1 = require("../services/next-send-time.service");
const last_sent_time_service_1 = require("../services/last-sent-time.service");
const normalizeDomain = (value) => String(value || "")
    .trim()
    .toLowerCase();
const isValidDomain = (value) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
const getRequestUserId = (req) => {
    if (!req.userId)
        throw new Error("Unauthorized");
    return new mongoose_1.Types.ObjectId(req.userId);
};
// ─── Sending Domains ──────────────────────────────────────────────────────────
const listUserDomains = async (req, res) => {
    const userId = getRequestUserId(req);
    // Fetch the user's assigned platform domain IDs
    const userRecord = await User_model_1.default.findById(userId).select("assignedDomainIds").lean();
    const assignedIds = (userRecord?.assignedDomainIds || []).map((id) => id.toString());
    if (assignedIds.length === 0) {
        res.json([]);
        return;
    }
    const domains = await SendingDomain_model_1.SendingDomain.find({
        _id: { $in: assignedIds },
        userId: null,
    })
        .sort({ isDefault: -1, domain: 1 })
        .select("domain isActive isDefault verificationStatus")
        .lean();
    res.json(domains);
};
exports.listUserDomains = listUserDomains;
const createUserDomain = async (req, res) => {
    const userId = getRequestUserId(req);
    const normalizedDomain = normalizeDomain(req.body.domain);
    if (!isValidDomain(normalizedDomain)) {
        res.status(400).json({ message: "Please provide a valid domain name." });
        return;
    }
    const existing = await SendingDomain_model_1.SendingDomain.findOne({ domain: normalizedDomain });
    if (existing) {
        res.status(409).json({ message: "This domain is already registered." });
        return;
    }
    if (req.body.isDefault === true) {
        await SendingDomain_model_1.SendingDomain.updateMany({ userId }, { $set: { isDefault: false } });
    }
    const domain = new SendingDomain_model_1.SendingDomain({
        domain: normalizedDomain,
        userId,
        isActive: false, // inactive until user verifies DNS
        verificationStatus: "pending",
        isDefault: Boolean(req.body.isDefault),
        notes: req.body.notes || "",
    });
    await domain.save();
    res.status(201).json(domain);
};
exports.createUserDomain = createUserDomain;
const deleteUserDomain = async (req, res) => {
    const userId = getRequestUserId(req);
    const id = req.params.id;
    const domain = await SendingDomain_model_1.SendingDomain.findOneAndDelete({ _id: id, userId });
    if (!domain) {
        res.status(404).json({ message: "Domain not found." });
        return;
    }
    // Delete the associated relay if one exists for this user/domain
    const domainStr = domain.domain;
    await SmtpRelay_model_1.default.deleteMany({ userId, notes: `auto:${domainStr}` });
    res.json({ message: "Domain deleted." });
};
exports.deleteUserDomain = deleteUserDomain;
const setUserDefaultDomain = async (req, res) => {
    const userId = getRequestUserId(req);
    const id = req.params.id;
    const target = await SendingDomain_model_1.SendingDomain.findOne({ _id: id, userId });
    if (!target) {
        res.status(404).json({ message: "Domain not found." });
        return;
    }
    if (target.verificationStatus !== "verified") {
        res.status(400).json({ message: "Only verified domains can be set as default." });
        return;
    }
    await SendingDomain_model_1.SendingDomain.updateMany({ userId }, { $set: { isDefault: false } });
    target.isDefault = true;
    await target.save();
    res.json(target);
};
exports.setUserDefaultDomain = setUserDefaultDomain;
// ─── SMTP Relays (per-user) ───────────────────────────────────────────────────
const listUserRelays = async (req, res) => {
    const userId = getRequestUserId(req);
    const relays = await SmtpRelay_model_1.default.find({ userId })
        .sort({ isActive: -1, createdAt: -1 })
        .select("-password")
        .lean();
    res.json(relays.map((r) => ({
        ...r,
        passwordConfigured: Boolean(r.password),
    })));
};
exports.listUserRelays = listUserRelays;
const createUserRelay = async (req, res) => {
    const userId = getRequestUserId(req);
    const { name, host, port, username, password, secure, tlsRejectUnauthorized, notes } = req.body;
    if (!host || !port) {
        res.status(400).json({ message: "host and port are required." });
        return;
    }
    const relay = new SmtpRelay_model_1.default({
        name: name || host,
        host: String(host).trim().toLowerCase(),
        port: Number(port),
        username: username || "",
        password: password || "",
        secure: Boolean(secure),
        tlsRejectUnauthorized: tlsRejectUnauthorized !== false,
        isActive: true,
        isArchived: false,
        weight: 1,
        userId,
        notes: notes || "",
    });
    await relay.save();
    res.status(201).json({
        ...relay.toObject(),
        password: undefined,
        passwordConfigured: Boolean(password),
    });
};
exports.createUserRelay = createUserRelay;
const updateUserRelay = async (req, res) => {
    const userId = getRequestUserId(req);
    const id = req.params.id;
    const allowed = ["name", "host", "port", "username", "password", "secure", "tlsRejectUnauthorized", "isActive", "notes"];
    const updates = {};
    for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
            updates[key] = req.body[key];
        }
    }
    if (!updates.password) {
        delete updates.password; // don't wipe password if not provided
    }
    const relay = await SmtpRelay_model_1.default.findOneAndUpdate({ _id: id, userId }, { $set: updates }, { returnDocument: "after" });
    if (!relay) {
        res.status(404).json({ message: "Relay not found." });
        return;
    }
    const relayObj = relay.toObject();
    delete relayObj.password;
    res.json({ ...relayObj, passwordConfigured: Boolean(relay.password) });
};
exports.updateUserRelay = updateUserRelay;
const deleteUserRelay = async (req, res) => {
    const userId = getRequestUserId(req);
    const id = req.params.id;
    const relay = await SmtpRelay_model_1.default.findOneAndDelete({ _id: id, userId });
    if (!relay) {
        res.status(404).json({ message: "Relay not found." });
        return;
    }
    res.json({ message: "Relay deleted." });
};
exports.deleteUserRelay = deleteUserRelay;
// ─── Link relay to domain ─────────────────────────────────────────────────────
const linkRelayToDomain = async (req, res) => {
    const userId = getRequestUserId(req);
    const { domainId, relayId } = req.body;
    if (!mongoose_1.Types.ObjectId.isValid(domainId) || !mongoose_1.Types.ObjectId.isValid(relayId)) {
        res.status(400).json({ message: "Invalid domainId or relayId." });
        return;
    }
    const [domain, relay] = await Promise.all([
        SendingDomain_model_1.SendingDomain.findOne({ _id: domainId, userId }),
        SmtpRelay_model_1.default.findOne({ _id: relayId, userId }),
    ]);
    if (!domain) {
        res.status(404).json({ message: "Domain not found." });
        return;
    }
    if (!relay) {
        res.status(404).json({ message: "Relay not found." });
        return;
    }
    // smtpRelayIds is ObjectId[] at runtime; cast through unknown to satisfy the typed schema field
    domain.smtpRelayIds = [relayId];
    await domain.save();
    res.json(domain);
};
exports.linkRelayToDomain = linkRelayToDomain;
// ─── Next Send Time ─────────────────────────────────────────────────────────
const getUserNextSendTime = async (req, res) => {
    const userId = getRequestUserId(req);
    const next = await (0, next_send_time_service_1.getNextAllowedSendTime)(userId.toString());
    res.json({ nextSendTime: next });
};
exports.getUserNextSendTime = getUserNextSendTime;
const getUserSendTimes = async (req, res) => {
    const userId = getRequestUserId(req);
    const [lastSent, nextSend] = await Promise.all([
        (0, last_sent_time_service_1.getLastSentTime)(userId.toString()),
        (0, next_send_time_service_1.getNextAllowedSendTime)(userId.toString()),
    ]);
    res.json({ lastSentTime: lastSent, nextSendTime: nextSend });
};
exports.getUserSendTimes = getUserSendTimes;
//# sourceMappingURL=user-domain.controller.js.map