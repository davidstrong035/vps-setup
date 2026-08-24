"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetDomainUsage = exports.resetBounceComplaint = exports.setReputationScore = exports.setCooldown = exports.setBlocklistStatus = exports.setDefaultDomain = exports.deleteDomain = exports.updateDomain = exports.createDomain = exports.getAllDomains = void 0;
const mongoose_1 = require("mongoose");
const SmtpRelay_model_1 = __importDefault(require("../models/SmtpRelay.model"));
const SendingDomain_model_1 = require("../models/SendingDomain.model");
const User_model_1 = __importDefault(require("../models/User.model"));
const getRouteId = (req) => Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
const normalizeDomain = (value) => String(value || '')
    .trim()
    .toLowerCase();
const isValidDomain = (value) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
const normalizeRelayIds = (value) => Array.from(new Set((Array.isArray(value) ? value : [])
    .map((relayId) => String(relayId || '').trim())
    .filter(Boolean)));
const validateRelayIds = async (value) => {
    const relayIds = normalizeRelayIds(value);
    const invalidRelayId = relayIds.find((relayId) => !mongoose_1.Types.ObjectId.isValid(relayId));
    if (invalidRelayId) {
        return 'One or more selected SMTP relay IDs are invalid.';
    }
    if (relayIds.length === 0) {
        return null;
    }
    const existingCount = await SmtpRelay_model_1.default.countDocuments({
        _id: { $in: relayIds.map((relayId) => new mongoose_1.Types.ObjectId(relayId)) },
    });
    if (existingCount !== relayIds.length) {
        return 'One or more selected SMTP relays no longer exist.';
    }
    return null;
};
const getAllDomains = async (_req, res) => {
    const domains = await SendingDomain_model_1.SendingDomain.find().populate('userId', '_id name email').sort({ isDefault: -1, createdAt: -1 });
    // For platform domains (userId: null), reverse-lookup all users that have them assigned
    const platformDomainIds = domains
        .filter((d) => !d.userId)
        .map((d) => d._id);
    const usersWithAssignments = platformDomainIds.length > 0
        ? await User_model_1.default.find({ assignedDomainIds: { $in: platformDomainIds } })
            .select('_id name email assignedDomainIds')
            .lean()
        : [];
    // Build a map: domainId -> array of users
    const domainUsersMap = new Map();
    for (const user of usersWithAssignments) {
        for (const domainId of (user.assignedDomainIds || [])) {
            const key = domainId.toString();
            if (!domainUsersMap.has(key))
                domainUsersMap.set(key, []);
            domainUsersMap.get(key).push({ _id: user._id, name: user.name, email: user.email });
        }
    }
    const result = domains.map((d) => {
        const obj = d.toObject();
        if (obj.userId) {
            // user-owned domain
            obj.owner = obj.userId;
            obj.assignedUsers = [];
        }
        else {
            // platform domain — may be assigned to multiple users
            obj.owner = null;
            obj.assignedUsers = domainUsersMap.get(obj._id.toString()) || [];
        }
        delete obj.userId;
        return obj;
    });
    res.json(result);
};
exports.getAllDomains = getAllDomains;
const createDomain = async (req, res) => {
    const normalizedDomain = normalizeDomain(req.body.domain);
    if (!isValidDomain(normalizedDomain)) {
        res.status(400).json({ message: 'Please provide a valid domain name.' });
        return;
    }
    const relayValidationError = await validateRelayIds(req.body.smtpRelayIds);
    if (relayValidationError) {
        res.status(400).json({ message: relayValidationError });
        return;
    }
    let userId = null;
    if (req.body.userId) {
        if (!mongoose_1.Types.ObjectId.isValid(req.body.userId)) {
            return res.status(400).json({ message: 'Invalid userId.' });
        }
        const user = await User_model_1.default.findById(req.body.userId);
        if (!user) {
            return res.status(400).json({ message: 'User not found.' });
        }
        userId = user._id;
    }
    if (req.body.isDefault === true) {
        await SendingDomain_model_1.SendingDomain.updateMany({}, { $set: { isDefault: false } });
    }
    const domain = new SendingDomain_model_1.SendingDomain({
        ...req.body,
        domain: normalizedDomain,
        smtpRelayIds: normalizeRelayIds(req.body.smtpRelayIds),
        userId: userId || undefined,
    });
    await domain.save();
    await domain.populate('userId', '_id name email');
    const obj = domain.toObject();
    obj.owner = obj.userId || null;
    delete obj.userId;
    res.status(201).json(obj);
};
exports.createDomain = createDomain;
const updateDomain = async (req, res) => {
    const id = getRouteId(req);
    const updates = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(updates, 'domain')) {
        const normalizedDomain = normalizeDomain(updates.domain);
        if (!isValidDomain(normalizedDomain)) {
            res.status(400).json({ message: 'Please provide a valid domain name.' });
            return;
        }
        updates.domain = normalizedDomain;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'smtpRelayIds')) {
        const relayValidationError = await validateRelayIds(updates.smtpRelayIds);
        if (relayValidationError) {
            res.status(400).json({ message: relayValidationError });
            return;
        }
        updates.smtpRelayIds = normalizeRelayIds(updates.smtpRelayIds);
    }
    if (updates.isDefault === true) {
        await SendingDomain_model_1.SendingDomain.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
    }
    const domain = await SendingDomain_model_1.SendingDomain.findByIdAndUpdate(id, updates, {
        returnDocument: 'after',
    }).populate('userId', '_id name email');
    if (!domain) {
        res.status(404).json({ message: 'Domain not found' });
        return;
    }
    const obj = domain.toObject();
    obj.owner = obj.userId || null;
    delete obj.userId;
    res.json(obj);
};
exports.updateDomain = updateDomain;
const deleteDomain = async (req, res) => {
    const id = getRouteId(req);
    const domain = await SendingDomain_model_1.SendingDomain.findByIdAndDelete(id);
    if (!domain) {
        res.status(404).json({ message: 'Domain not found' });
        return;
    }
    res.json({ message: 'Domain deleted' });
};
exports.deleteDomain = deleteDomain;
const setDefaultDomain = async (req, res) => {
    const id = getRouteId(req);
    const target = await SendingDomain_model_1.SendingDomain.findById(id);
    if (!target) {
        res.status(404).json({ message: 'Domain not found' });
        return;
    }
    await SendingDomain_model_1.SendingDomain.updateMany({}, { $set: { isDefault: false } });
    target.isDefault = true;
    await target.save();
    res.json(target);
};
exports.setDefaultDomain = setDefaultDomain;
const setBlocklistStatus = async (req, res) => {
    const id = getRouteId(req);
    const { blocklisted } = req.body;
    const domain = await SendingDomain_model_1.SendingDomain.findByIdAndUpdate(id, { blocklisted }, {
        returnDocument: 'after',
    });
    if (!domain) {
        res.status(404).json({ message: 'Domain not found' });
        return;
    }
    res.json(domain);
};
exports.setBlocklistStatus = setBlocklistStatus;
const setCooldown = async (req, res) => {
    const id = getRouteId(req);
    const { cooldownUntil } = req.body;
    const domain = await SendingDomain_model_1.SendingDomain.findByIdAndUpdate(id, { cooldownUntil }, {
        returnDocument: 'after',
    });
    if (!domain) {
        res.status(404).json({ message: 'Domain not found' });
        return;
    }
    res.json(domain);
};
exports.setCooldown = setCooldown;
const setReputationScore = async (req, res) => {
    const id = getRouteId(req);
    const { reputationScore } = req.body;
    const domain = await SendingDomain_model_1.SendingDomain.findByIdAndUpdate(id, { reputationScore }, {
        returnDocument: 'after',
    });
    if (!domain) {
        res.status(404).json({ message: 'Domain not found' });
        return;
    }
    res.json(domain);
};
exports.setReputationScore = setReputationScore;
const resetBounceComplaint = async (req, res) => {
    const id = getRouteId(req);
    const domain = await SendingDomain_model_1.SendingDomain.findByIdAndUpdate(id, { bounceCount: 0, complaintCount: 0 }, { returnDocument: 'after' });
    if (!domain) {
        res.status(404).json({ message: 'Domain not found' });
        return;
    }
    res.json(domain);
};
exports.resetBounceComplaint = resetBounceComplaint;
const resetDomainUsage = async (req, res) => {
    const id = getRouteId(req);
    const domain = await SendingDomain_model_1.SendingDomain.findByIdAndUpdate(id, { usedToday: 0 }, {
        returnDocument: 'after',
    });
    if (!domain) {
        res.status(404).json({ message: 'Domain not found' });
        return;
    }
    res.json(domain);
};
exports.resetDomainUsage = resetDomainUsage;
//# sourceMappingURL=domain.controller.js.map