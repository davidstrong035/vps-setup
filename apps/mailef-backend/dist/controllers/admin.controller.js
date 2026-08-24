"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRecoverCampaign = exports.adminPauseAllUserCampaigns = exports.adminVerifyUserDomain = exports.adminListPendingUserDomains = exports.adminPauseCampaign = exports.adminReleaseCampaignPause = exports.reconcileUserAllocation = exports.extendUserEmailAllocation = exports.updateUserAssignedDomains = exports.getUserAssignedDomains = exports.adminDeletePlatformDomain = exports.getAuditLogs = exports.updateUserEmailAllocation = exports.suspendUserEmailAllocation = exports.createUserEmailAllocation = exports.getUserEmailAllocation = exports.updateUserSendLimits = exports.getUserSendLimits = exports.updateGlobalSendLimits = exports.updatePlatformDispatchSettingsForAdmin = exports.getPlatformDispatchSettingsForAdmin = exports.deleteSmtpRelayForAdmin = exports.setSmtpRelayArchivedStateForAdmin = exports.setSmtpRelayActiveStateForAdmin = exports.updateSmtpRelayForAdmin = exports.createSmtpRelayForAdmin = exports.getSmtpRelaysForAdmin = exports.updatePlatformMailSettingsForAdmin = exports.testPlatformMailSettingsForAdmin = exports.getPlatformMailSettingsForAdmin = exports.getSystemHealthHandler = exports.getGlobalQuotaUsageHandler = exports.getGlobalSendLimits = exports.getUserStats = exports.createAdmin = exports.resetUserPassword = exports.updateUserAccess = exports.getUsers = exports.getAdminOverview = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const mongoose_1 = require("mongoose");
const Campaign_model_1 = __importDefault(require("../models/Campaign.model"));
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
const List_model_1 = __importDefault(require("../models/List.model"));
const Subscriber_model_1 = __importDefault(require("../models/Subscriber.model"));
const Template_model_1 = __importDefault(require("../models/Template.model"));
const User_model_1 = __importDefault(require("../models/User.model"));
const AuditLog_model_1 = __importDefault(require("../models/AuditLog.model"));
const SendingDomain_model_1 = require("../models/SendingDomain.model");
const audit_log_service_1 = require("../services/audit-log.service");
const campaign_dispatch_service_1 = require("../services/campaign-dispatch.service");
const mailer_service_1 = require("../services/mailer.service");
const logger_1 = require("../utils/logger");
const email_allocation_service_1 = require("../services/email-allocation.service");
const platform_settings_service_1 = require("../services/platform-settings.service");
const smtp_relay_service_1 = require("../services/smtp-relay.service");
const rate_limit_service_1 = require("../services/rate-limit.service");
const global_quota_usage_service_1 = require("../services/global-quota-usage.service");
const monitoring_service_1 = require("../services/monitoring.service");
const validateRateLimitBody = (body) => {
    const fields = ["perMinute", "perHour", "perDay"];
    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(body, field))
            continue;
        const raw = body[field];
        if (raw === undefined || raw === null || raw === "")
            continue;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
            return `${field} must be a positive integer or empty`;
        }
    }
    return null;
};
const validateEmailAllocationBody = (body) => {
    const amountPaid = Number(body.amountPaid);
    const emailsPurchased = Number(body.emailsPurchased);
    const currency = String(body.currency || "").trim();
    const paidAt = new Date(String(body.paidAt || ""));
    const expiresAt = new Date(String(body.expiresAt || ""));
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
        return "amountPaid must be a valid non-negative number";
    }
    if (!Number.isFinite(emailsPurchased) || emailsPurchased <= 0 || !Number.isInteger(emailsPurchased)) {
        return "emailsPurchased must be a positive integer";
    }
    if (!currency || currency.length < 3) {
        return "currency is required";
    }
    if (Number.isNaN(paidAt.getTime())) {
        return "paidAt must be a valid date";
    }
    if (Number.isNaN(expiresAt.getTime())) {
        return "expiresAt must be a valid date";
    }
    if (expiresAt <= paidAt) {
        return "expiresAt must be later than paidAt";
    }
    return null;
};
const validatePlatformMailSettingsBody = (body) => {
    if (body.provider !== undefined &&
        body.provider !== "ses" &&
        body.provider !== "smtp") {
        return "provider must be either ses or smtp";
    }
    if (body.defaultFromName !== undefined &&
        typeof body.defaultFromName !== "string") {
        return "defaultFromName must be a string";
    }
    if (body.verifiedFromEmail !== undefined &&
        typeof body.verifiedFromEmail !== "string") {
        return "verifiedFromEmail must be a string";
    }
    if (body.configurationSetName !== undefined &&
        typeof body.configurationSetName !== "string") {
        return "configurationSetName must be a string";
    }
    if (body.smtpHost !== undefined && typeof body.smtpHost !== "string") {
        return "smtpHost must be a string";
    }
    if (body.smtpUsername !== undefined && typeof body.smtpUsername !== "string") {
        return "smtpUsername must be a string";
    }
    if (body.smtpPassword !== undefined && typeof body.smtpPassword !== "string") {
        return "smtpPassword must be a string";
    }
    if (body.smtpPort !== undefined &&
        body.smtpPort !== null &&
        body.smtpPort !== "") {
        const smtpPort = Number(body.smtpPort);
        if (!Number.isFinite(smtpPort) ||
            !Number.isInteger(smtpPort) ||
            smtpPort < 1 ||
            smtpPort > 65535) {
            return "smtpPort must be a valid TCP port";
        }
    }
    if (body.smtpSecure !== undefined && typeof body.smtpSecure !== "boolean") {
        return "smtpSecure must be a boolean";
    }
    if (body.smtpTlsRejectUnauthorized !== undefined &&
        typeof body.smtpTlsRejectUnauthorized !== "boolean") {
        return "smtpTlsRejectUnauthorized must be a boolean";
    }
    const verifiedFromEmail = String(body.verifiedFromEmail || "").trim();
    if (verifiedFromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedFromEmail)) {
        return "verifiedFromEmail must be a valid email address";
    }
    return null;
};
const validatePlatformDispatchSettingsBody = (body) => {
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
        return "enabled must be a boolean";
    }
    const numericFields = [
        { key: "intervalMs", min: 2000 },
        { key: "usersPerTick", min: 1 },
        { key: "maxPerRun", min: 100 },
        { key: "workerConcurrency", min: 1 },
        { key: "workerRateLimitMax", min: 1 },
        { key: "workerRateLimitDurationMs", min: 100 },
    ];
    for (const field of numericFields) {
        if (!Object.prototype.hasOwnProperty.call(body, field.key))
            continue;
        const raw = body[field.key];
        if (raw === undefined || raw === null || raw === "")
            continue;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < field.min || !Number.isInteger(parsed)) {
            return `${field.key} must be an integer greater than or equal to ${field.min}`;
        }
    }
    return null;
};
const validateSmtpRelayBody = (body, options = {}) => {
    const { partial = false } = options;
    if ((!partial || Object.prototype.hasOwnProperty.call(body, "name")) && typeof body.name !== "string") {
        return "name must be a string";
    }
    if ((!partial || Object.prototype.hasOwnProperty.call(body, "name")) && !String(body.name || "").trim()) {
        return "name is required";
    }
    if ((!partial || Object.prototype.hasOwnProperty.call(body, "host")) && typeof body.host !== "string") {
        return "host must be a string";
    }
    const host = String(body.host || "").trim();
    if ((!partial || Object.prototype.hasOwnProperty.call(body, "host")) && !host) {
        return "host is required";
    }
    if (host && !/^[a-z0-9.-]+$/i.test(host)) {
        return "host must be a valid hostname or IP";
    }
    if (Object.prototype.hasOwnProperty.call(body, "port")) {
        const parsed = Number(body.port);
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
            return "port must be a valid TCP port";
        }
    }
    if (body.username !== undefined && typeof body.username !== "string") {
        return "username must be a string";
    }
    if (body.password !== undefined && typeof body.password !== "string") {
        return "password must be a string";
    }
    if (body.secure !== undefined && typeof body.secure !== "boolean") {
        return "secure must be a boolean";
    }
    if (body.tlsRejectUnauthorized !== undefined &&
        typeof body.tlsRejectUnauthorized !== "boolean") {
        return "tlsRejectUnauthorized must be a boolean";
    }
    if (Object.prototype.hasOwnProperty.call(body, "weight")) {
        const parsed = Number(body.weight);
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
            return "weight must be a positive integer";
        }
    }
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
        return "isActive must be a boolean";
    }
    if (body.isArchived !== undefined && typeof body.isArchived !== "boolean") {
        return "isArchived must be a boolean";
    }
    if (body.notes !== undefined && typeof body.notes !== "string") {
        return "notes must be a string";
    }
    return null;
};
const extractSmtpRelayInput = (body) => ({
    name: body.name !== undefined ? String(body.name || "").trim() : undefined,
    host: body.host !== undefined ? String(body.host || "").trim() : undefined,
    port: body.port !== undefined && body.port !== null && body.port !== ""
        ? Number(body.port)
        : undefined,
    username: body.username !== undefined ? String(body.username || "").trim() : undefined,
    password: body.password !== undefined ? String(body.password) : undefined,
    secure: typeof body.secure === "boolean" ? body.secure : undefined,
    tlsRejectUnauthorized: typeof body.tlsRejectUnauthorized === "boolean"
        ? body.tlsRejectUnauthorized
        : undefined,
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    isArchived: typeof body.isArchived === "boolean" ? body.isArchived : undefined,
    weight: body.weight !== undefined && body.weight !== null && body.weight !== ""
        ? Number(body.weight)
        : undefined,
    notes: body.notes !== undefined ? String(body.notes || "") : undefined,
});
const getAdminOverview = async (_req, res) => {
    try {
        const [usersTotal, adminsTotal, activeUsers, campaignsTotal, listsTotal, templatesTotal, subscribersTotal,] = await Promise.all([
            User_model_1.default.countDocuments({}),
            User_model_1.default.countDocuments({ role: { $in: ["admin", "super_admin"] } }),
            User_model_1.default.countDocuments({ isActive: true }),
            Campaign_model_1.default.countDocuments({}),
            List_model_1.default.countDocuments({}),
            Template_model_1.default.countDocuments({}),
            Subscriber_model_1.default.countDocuments({}),
        ]);
        const sentAgg = await Campaign_model_1.default.aggregate([
            { $group: { _id: null, totalSent: { $sum: "$stats.sent" } } },
        ]);
        res.json({
            overview: {
                usersTotal,
                adminsTotal,
                activeUsers,
                campaignsTotal,
                listsTotal,
                templatesTotal,
                subscribersTotal,
                emailsSentTotal: sentAgg[0]?.totalSent ?? 0,
            },
        });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get admin overview", error });
    }
};
exports.getAdminOverview = getAdminOverview;
const getUsers = async (req, res) => {
    try {
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
        const search = String(req.query.search || "").trim();
        const role = String(req.query.role || "all").trim();
        const status = String(req.query.status || "all").trim();
        const sortBy = String(req.query.sortBy || "createdAt").trim();
        const sortOrder = String(req.query.sortOrder || "desc").trim() === "asc" ? 1 : -1;
        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
            ];
        }
        if (["user", "admin", "super_admin"].includes(role)) {
            query.role = role;
        }
        if (status === "active") {
            query.isActive = true;
        }
        else if (status === "disabled") {
            query.isActive = false;
        }
        const allowedSortFields = new Set(["createdAt", "name", "email", "role"]);
        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "createdAt";
        const [users, total] = await Promise.all([
            User_model_1.default.find(query)
                .select("_id name email role isActive createdAt")
                .sort({ [safeSortBy]: sortOrder })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            User_model_1.default.countDocuments(query),
        ]);
        res.json({
            users,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get users", error });
    }
};
exports.getUsers = getUsers;
const updateUserAccess = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const { role, isActive } = req.body;
        // Resolve actor role from the database, not the JWT, for all privilege checks.
        const actorRecord = await User_model_1.default.findById(req.userId).select("role").lean();
        const actorRole = actorRecord?.role ?? "user";
        if (role !== undefined && !["user", "admin", "super_admin"].includes(role)) {
            await (0, audit_log_service_1.logAuditFromRequest)(req, {
                action: "admin.user_access.update",
                resourceType: "user",
                resourceId: targetUserId,
                targetUserId,
                status: "failure",
                metadata: { reason: "invalid_role", role },
            });
            res.status(400).json({ message: "Invalid role" });
            return;
        }
        if (isActive !== undefined && typeof isActive !== "boolean") {
            res.status(400).json({ message: "isActive must be boolean" });
            return;
        }
        // Only super_admin can change roles at all (promote or demote anyone).
        if (role !== undefined && actorRole !== "super_admin") {
            await (0, audit_log_service_1.logAuditFromRequest)(req, {
                action: "admin.user_access.update",
                resourceType: "user",
                resourceId: targetUserId,
                targetUserId,
                status: "failure",
                metadata: { reason: "forbidden_role_change", actorRole, requestedRole: role },
            });
            res.status(403).json({ message: "Only super admins can change roles" });
            return;
        }
        const targetUser = await User_model_1.default.findById(targetUserId);
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        if (req.userId === targetUser._id.toString() && role === "user") {
            res.status(400).json({ message: "You cannot demote your own admin account" });
            return;
        }
        if (req.userId === targetUser._id.toString() && isActive === false) {
            res.status(400).json({ message: "You cannot disable your own account" });
            return;
        }
        // Only super_admin can touch another super_admin account.
        if (targetUser.role === "super_admin" && actorRole !== "super_admin") {
            res.status(403).json({ message: "Only super admins can modify super admin accounts" });
            return;
        }
        if (role !== undefined)
            targetUser.role = role;
        if (isActive !== undefined)
            targetUser.isActive = isActive;
        await targetUser.save();
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.user_access.update",
            resourceType: "user",
            resourceId: targetUser._id.toString(),
            targetUserId: targetUser._id.toString(),
            status: "success",
            metadata: {
                role: targetUser.role,
                isActive: targetUser.isActive,
            },
        });
        res.json({
            user: {
                _id: targetUser._id,
                name: targetUser.name,
                email: targetUser.email,
                role: targetUser.role,
                isActive: targetUser.isActive,
            },
        });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update user", error });
    }
};
exports.updateUserAccess = updateUserAccess;
const resetUserPassword = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const { newPassword } = req.body;
        if (!newPassword || String(newPassword).length < 6) {
            res.status(400).json({ message: "New password must be at least 6 characters" });
            return;
        }
        const actorRecord = await User_model_1.default.findById(req.userId).select("role").lean();
        const actorRole = actorRecord?.role ?? "user";
        if (actorRole !== "admin" && actorRole !== "super_admin") {
            await (0, audit_log_service_1.logAuditFromRequest)(req, {
                action: "admin.user_password.reset",
                resourceType: "user",
                resourceId: targetUserId,
                targetUserId,
                status: "failure",
                metadata: { reason: "forbidden", actorRole },
            });
            res.status(403).json({ message: "Forbidden" });
            return;
        }
        const targetUser = await User_model_1.default.findById(targetUserId);
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        // Only super_admin can reset another super_admin's password
        if (targetUser.role === "super_admin" && actorRole !== "super_admin") {
            res.status(403).json({ message: "Only super admins can reset super admin passwords" });
            return;
        }
        // Cannot reset your own password via this endpoint — use /auth/reset-password instead
        if (req.userId === targetUser._id.toString()) {
            res.status(400).json({ message: "Use the profile settings to change your own password" });
            return;
        }
        targetUser.password = String(newPassword);
        targetUser.passwordResetToken = null;
        targetUser.passwordResetExpires = null;
        await targetUser.save();
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.user_password.reset",
            resourceType: "user",
            resourceId: targetUser._id.toString(),
            targetUserId: targetUser._id.toString(),
            status: "success",
            metadata: { email: targetUser.email },
        });
        res.json({ message: `Password reset for ${targetUser.email}` });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to reset password", error });
    }
};
exports.resetUserPassword = resetUserPassword;
const createAdmin = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        // Always verify the actor's role from the database — never trust the JWT
        // claim alone for a privilege-sensitive operation like this.
        const actorRecord = await User_model_1.default.findById(req.userId).select("role").lean();
        const actorRole = actorRecord?.role ?? "user";
        // Resolve the requested role — treat anything other than the literal
        // string "super_admin" as "admin" so no invalid value can escalate.
        const requestedRole = role === "super_admin" ? "super_admin" : "admin";
        // Hard gate checked against the live DB role, not the JWT claim.
        if (requestedRole === "super_admin" && actorRole !== "super_admin") {
            await (0, audit_log_service_1.logAuditFromRequest)(req, {
                action: "admin.account.create",
                resourceType: "user",
                status: "failure",
                metadata: {
                    reason: "forbidden_super_admin_creation",
                    actorRole,
                    requestedRole,
                },
            });
            res
                .status(403)
                .json({ message: "Only super admins can create super admin accounts" });
            return;
        }
        if (!name || !email || !password) {
            await (0, audit_log_service_1.logAuditFromRequest)(req, {
                action: "admin.account.create",
                resourceType: "user",
                status: "failure",
                metadata: { reason: "missing_required_fields" },
            });
            res.status(400).json({ message: "name, email and password are required" });
            return;
        }
        if (String(password).length < 6) {
            res.status(400).json({ message: "password must be at least 6 characters" });
            return;
        }
        const normalizedEmail = String(email).trim().toLowerCase();
        const exists = await User_model_1.default.findOne({ email: normalizedEmail });
        if (exists) {
            await (0, audit_log_service_1.logAuditFromRequest)(req, {
                action: "admin.account.create",
                resourceType: "user",
                status: "failure",
                metadata: { reason: "email_already_in_use", email: normalizedEmail },
            });
            res.status(409).json({ message: "Email already in use" });
            return;
        }
        const hashed = await bcryptjs_1.default.hash(password, 12);
        const admin = await User_model_1.default.create({
            name: String(name).trim(),
            email: normalizedEmail,
            password: hashed,
            role: requestedRole,
            isActive: true,
        });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.account.create",
            resourceType: "user",
            resourceId: admin._id.toString(),
            targetUserId: admin._id.toString(),
            status: "success",
            metadata: { email: admin.email, role: admin.role },
        });
        res.status(201).json({
            user: {
                _id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
                isActive: admin.isActive,
                createdAt: admin.createdAt,
            },
        });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to create admin", error });
    }
};
exports.createAdmin = createAdmin;
const getUserStats = async (req, res) => {
    try {
        const targetUser = await User_model_1.default.findById(req.params.id)
            .select("_id name email role isActive createdAt")
            .lean();
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const [campaignsTotal, listsTotal, templatesTotal, subscribersTotal] = await Promise.all([
            Campaign_model_1.default.countDocuments({ userId: targetUser._id }),
            List_model_1.default.countDocuments({ userId: targetUser._id }),
            Template_model_1.default.countDocuments({ userId: targetUser._id }),
            Subscriber_model_1.default.countDocuments({ userId: targetUser._id }),
        ]);
        const campaignSums = await Campaign_model_1.default.aggregate([
            { $match: { userId: targetUser._id } },
            {
                $group: {
                    _id: null,
                    sent: { $sum: "$stats.sent" },
                    opened: { $sum: "$stats.opened" },
                    clicked: { $sum: "$stats.clicked" },
                    bounced: { $sum: "$stats.bounced" },
                    unsubscribed: { $sum: "$stats.unsubscribed" },
                },
            },
        ]);
        const recentCampaigns = await Campaign_model_1.default.find({ userId: targetUser._id })
            .select("name status pausedBy pauseReason stats createdAt")
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();
        const sums = campaignSums[0] || {
            sent: 0,
            opened: 0,
            clicked: 0,
            bounced: 0,
            unsubscribed: 0,
        };
        res.json({
            user: targetUser,
            stats: {
                campaignsTotal,
                listsTotal,
                templatesTotal,
                subscribersTotal,
                emailsSent: sums.sent,
                opens: sums.opened,
                clicks: sums.clicked,
                bounces: sums.bounced,
                unsubscribes: sums.unsubscribed,
            },
            recentCampaigns,
        });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get user stats", error });
    }
};
exports.getUserStats = getUserStats;
const getGlobalSendLimits = async (_req, res) => {
    try {
        const limits = await (0, rate_limit_service_1.getGlobalRateLimits)();
        res.json({ limits });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get global send limits", error });
    }
};
exports.getGlobalSendLimits = getGlobalSendLimits;
const getGlobalQuotaUsageHandler = async (_req, res) => {
    try {
        const usage = await (0, global_quota_usage_service_1.getGlobalQuotaUsage)();
        res.json({ usage });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get global quota usage", error });
    }
};
exports.getGlobalQuotaUsageHandler = getGlobalQuotaUsageHandler;
const getSystemHealthHandler = async (_req, res) => {
    try {
        const health = await (0, monitoring_service_1.buildHealthStatus)();
        res.json(health);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get system health", error });
    }
};
exports.getSystemHealthHandler = getSystemHealthHandler;
const getPlatformMailSettingsForAdmin = async (_req, res) => {
    try {
        const mailSettings = await (0, platform_settings_service_1.getPlatformMailSettings)();
        res.json({ mailSettings: (0, platform_settings_service_1.toAdminMailSettings)(mailSettings) });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get platform mail settings", error });
    }
};
exports.getPlatformMailSettingsForAdmin = getPlatformMailSettingsForAdmin;
const testPlatformMailSettingsForAdmin = async (req, res) => {
    try {
        const body = req.body;
        const validationError = validatePlatformMailSettingsBody(body);
        if (validationError) {
            res.status(400).json({ message: validationError });
            return;
        }
        const provider = body.provider === "smtp" ? "smtp" : "ses";
        const defaultFromName = String(body.defaultFromName || "").trim() || "Maileff Team";
        const verifiedFromEmail = String(body.verifiedFromEmail || "").trim();
        const configurationSetName = String(body.configurationSetName || "").trim();
        const smtpHost = String(body.smtpHost || "").trim();
        const smtpPort = body.smtpPort !== undefined && body.smtpPort !== null && body.smtpPort !== ""
            ? Number(body.smtpPort)
            : undefined;
        const smtpUsername = String(body.smtpUsername || "").trim();
        const smtpPassword = body.smtpPassword !== undefined ? String(body.smtpPassword) : undefined;
        const smtpSecure = body.smtpSecure === true;
        const smtpTlsRejectUnauthorized = typeof body.smtpTlsRejectUnauthorized === "boolean"
            ? body.smtpTlsRejectUnauthorized
            : undefined;
        const connectionOnly = body.connectionOnly === true;
        const to = String(body.to || "").trim();
        if (!connectionOnly && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
            res.status(400).json({ message: "A valid test recipient email is required" });
            return;
        }
        await (0, mailer_service_1.verifyMailProvider)({
            provider,
            defaultFromName,
            verifiedFromEmail,
            configurationSetName,
            smtpHost,
            ...(smtpPort !== undefined ? { smtpPort } : {}),
            smtpUsername,
            ...(smtpPassword !== undefined ? { smtpPassword } : {}),
            smtpSecure,
            ...(smtpTlsRejectUnauthorized !== undefined
                ? { smtpTlsRejectUnauthorized }
                : {}),
        });
        let messageId = "";
        if (!connectionOnly) {
            messageId = await (0, mailer_service_1.sendEmail)({
                to,
                subject: `Maileff ${provider.toUpperCase()} test email`,
                html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
              <h2 style="margin-bottom: 0.5rem;">Mail provider test successful</h2>
              <p>This is a live test email from <strong>Maileff</strong>.</p>
              <p><strong>Provider:</strong> ${provider === "ses" ? "Amazon SES" : "SMTP / Postal"}</p>
              <p><strong>Time:</strong> ${new Date().toISOString()}</p>
            </div>
          `,
                fromName: defaultFromName,
                fromEmail: verifiedFromEmail ||
                    process.env.MAIL_FROM_EMAIL?.trim() ||
                    process.env.SMTP_FROM_EMAIL?.trim() ||
                    process.env.SES_FROM_EMAIL?.trim() ||
                    "",
            }, {
                provider,
                defaultFromName,
                verifiedFromEmail,
                configurationSetName,
                smtpHost,
                ...(smtpPort !== undefined ? { smtpPort } : {}),
                smtpUsername,
                ...(smtpPassword !== undefined ? { smtpPassword } : {}),
                smtpSecure,
                ...(smtpTlsRejectUnauthorized !== undefined
                    ? { smtpTlsRejectUnauthorized }
                    : {}),
            });
        }
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: connectionOnly ? "admin.mail_settings.verify" : "admin.mail_settings.test_send",
            resourceType: "platform_settings",
            resourceId: "platform",
            status: "success",
            metadata: {
                provider,
                connectionOnly,
                to: connectionOnly ? undefined : to,
                messageId: messageId || undefined,
            },
        });
        res.json({
            provider,
            messageId,
            message: connectionOnly
                ? provider === "smtp"
                    ? "SMTP connection verified successfully."
                    : "SES configuration looks ready."
                : "Test email sent successfully.",
        });
    }
    catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : "Failed to test mail provider",
        });
    }
};
exports.testPlatformMailSettingsForAdmin = testPlatformMailSettingsForAdmin;
const updatePlatformMailSettingsForAdmin = async (req, res) => {
    try {
        const body = req.body;
        const validationError = validatePlatformMailSettingsBody(body);
        if (validationError) {
            res.status(400).json({ message: validationError });
            return;
        }
        const mailSettings = await (0, platform_settings_service_1.updatePlatformMailSettings)({
            provider: body.provider === "smtp"
                ? "smtp"
                : body.provider === "ses"
                    ? "ses"
                    : undefined,
            defaultFromName: String(body.defaultFromName || "").trim(),
            verifiedFromEmail: String(body.verifiedFromEmail || "").trim(),
            configurationSetName: String(body.configurationSetName || "").trim(),
            smtpHost: String(body.smtpHost || "").trim(),
            smtpPort: body.smtpPort !== undefined && body.smtpPort !== null && body.smtpPort !== ""
                ? Number(body.smtpPort)
                : undefined,
            smtpUsername: String(body.smtpUsername || "").trim(),
            smtpPassword: body.smtpPassword !== undefined ? String(body.smtpPassword) : undefined,
            smtpSecure: typeof body.smtpSecure === "boolean" ? body.smtpSecure : undefined,
            smtpTlsRejectUnauthorized: typeof body.smtpTlsRejectUnauthorized === "boolean"
                ? body.smtpTlsRejectUnauthorized
                : undefined,
        });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.mail_settings.update",
            resourceType: "platform_settings",
            resourceId: "platform",
            status: "success",
            metadata: { mailSettings: (0, platform_settings_service_1.toAdminMailSettings)(mailSettings) },
        });
        res.json({ mailSettings: (0, platform_settings_service_1.toAdminMailSettings)(mailSettings) });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update platform mail settings", error });
    }
};
exports.updatePlatformMailSettingsForAdmin = updatePlatformMailSettingsForAdmin;
const getSmtpRelaysForAdmin = async (_req, res) => {
    try {
        const relays = await (0, smtp_relay_service_1.listAdminSmtpRelays)();
        res.json({ relays });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get SMTP relays", error });
    }
};
exports.getSmtpRelaysForAdmin = getSmtpRelaysForAdmin;
const createSmtpRelayForAdmin = async (req, res) => {
    try {
        const body = req.body;
        const validationError = validateSmtpRelayBody(body);
        if (validationError) {
            res.status(400).json({ message: validationError });
            return;
        }
        const relay = await (0, smtp_relay_service_1.createSmtpRelay)(extractSmtpRelayInput(body));
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.smtp_relay.create",
            resourceType: "smtp_relay",
            resourceId: relay._id,
            status: "success",
            metadata: { relay },
        });
        res.status(201).json({ relay });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to create SMTP relay", error });
    }
};
exports.createSmtpRelayForAdmin = createSmtpRelayForAdmin;
const updateSmtpRelayForAdmin = async (req, res) => {
    try {
        const relayId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const body = req.body;
        const validationError = validateSmtpRelayBody(body, { partial: true });
        if (validationError) {
            res.status(400).json({ message: validationError });
            return;
        }
        const relay = await (0, smtp_relay_service_1.updateSmtpRelay)(relayId, extractSmtpRelayInput(body));
        if (!relay) {
            res.status(404).json({ message: "SMTP relay not found" });
            return;
        }
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.smtp_relay.update",
            resourceType: "smtp_relay",
            resourceId: relay._id,
            status: "success",
            metadata: { relay },
        });
        res.json({ relay });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update SMTP relay", error });
    }
};
exports.updateSmtpRelayForAdmin = updateSmtpRelayForAdmin;
const setSmtpRelayActiveStateForAdmin = async (req, res) => {
    try {
        const relayId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (typeof req.body?.isActive !== "boolean") {
            res.status(400).json({ message: "isActive must be a boolean" });
            return;
        }
        const relay = await (0, smtp_relay_service_1.setSmtpRelayActiveState)(relayId, req.body.isActive);
        if (!relay) {
            res.status(404).json({ message: "SMTP relay not found" });
            return;
        }
        res.json({ relay });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update SMTP relay status", error });
    }
};
exports.setSmtpRelayActiveStateForAdmin = setSmtpRelayActiveStateForAdmin;
const setSmtpRelayArchivedStateForAdmin = async (req, res) => {
    try {
        const relayId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (typeof req.body?.isArchived !== "boolean") {
            res.status(400).json({ message: "isArchived must be a boolean" });
            return;
        }
        const relay = await (0, smtp_relay_service_1.setSmtpRelayArchivedState)(relayId, req.body.isArchived);
        if (!relay) {
            res.status(404).json({ message: "SMTP relay not found" });
            return;
        }
        res.json({ relay });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to archive SMTP relay", error });
    }
};
exports.setSmtpRelayArchivedStateForAdmin = setSmtpRelayArchivedStateForAdmin;
const deleteSmtpRelayForAdmin = async (req, res) => {
    try {
        const relayId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const deleted = await (0, smtp_relay_service_1.deleteSmtpRelay)(relayId);
        if (!deleted) {
            res.status(404).json({ message: "SMTP relay not found" });
            return;
        }
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.smtp_relay.delete",
            resourceType: "smtp_relay",
            resourceId: relayId,
            status: "success",
        });
        res.json({ message: "SMTP relay deleted" });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to delete SMTP relay", error });
    }
};
exports.deleteSmtpRelayForAdmin = deleteSmtpRelayForAdmin;
const getPlatformDispatchSettingsForAdmin = async (_req, res) => {
    try {
        const dispatchSettings = await (0, platform_settings_service_1.getPlatformDispatchSettings)();
        res.json({ dispatchSettings });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get platform dispatch settings", error });
    }
};
exports.getPlatformDispatchSettingsForAdmin = getPlatformDispatchSettingsForAdmin;
const updatePlatformDispatchSettingsForAdmin = async (req, res) => {
    try {
        const body = req.body;
        const validationError = validatePlatformDispatchSettingsBody(body);
        if (validationError) {
            res.status(400).json({ message: validationError });
            return;
        }
        const dispatchSettings = await (0, platform_settings_service_1.updatePlatformDispatchSettings)({
            enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
            intervalMs: body.intervalMs !== undefined && body.intervalMs !== null && body.intervalMs !== ""
                ? Number(body.intervalMs)
                : undefined,
            usersPerTick: body.usersPerTick !== undefined && body.usersPerTick !== null && body.usersPerTick !== ""
                ? Number(body.usersPerTick)
                : undefined,
            maxPerRun: body.maxPerRun !== undefined && body.maxPerRun !== null && body.maxPerRun !== ""
                ? Number(body.maxPerRun)
                : undefined,
            workerConcurrency: body.workerConcurrency !== undefined &&
                body.workerConcurrency !== null &&
                body.workerConcurrency !== ""
                ? Number(body.workerConcurrency)
                : undefined,
            workerRateLimitMax: body.workerRateLimitMax !== undefined &&
                body.workerRateLimitMax !== null &&
                body.workerRateLimitMax !== ""
                ? Number(body.workerRateLimitMax)
                : undefined,
            workerRateLimitDurationMs: body.workerRateLimitDurationMs !== undefined &&
                body.workerRateLimitDurationMs !== null &&
                body.workerRateLimitDurationMs !== ""
                ? Number(body.workerRateLimitDurationMs)
                : undefined,
        });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.dispatch_settings.update",
            resourceType: "platform_settings",
            resourceId: "platform",
            status: "success",
            metadata: { dispatchSettings },
        });
        res.json({ dispatchSettings });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update platform dispatch settings", error });
    }
};
exports.updatePlatformDispatchSettingsForAdmin = updatePlatformDispatchSettingsForAdmin;
const updateGlobalSendLimits = async (req, res) => {
    try {
        const body = req.body;
        const validationError = validateRateLimitBody(body);
        if (validationError) {
            res.status(400).json({ message: validationError });
            return;
        }
        const limits = (0, rate_limit_service_1.normalizeRateLimits)(body);
        const updated = await (0, rate_limit_service_1.upsertGlobalRateLimits)(limits);
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.rate_limits.global.update",
            resourceType: "rate_limit",
            resourceId: "global",
            status: "success",
            metadata: { limits: updated },
        });
        res.json({ limits: updated });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update global send limits", error });
    }
};
exports.updateGlobalSendLimits = updateGlobalSendLimits;
const getUserSendLimits = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const targetUser = await User_model_1.default.findById(targetUserId).select("_id").lean();
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const [userLimits, effective] = await Promise.all([
            (0, rate_limit_service_1.getUserRateLimits)(targetUserId),
            (0, rate_limit_service_1.getEffectiveRateLimits)(targetUserId),
        ]);
        res.json({
            userLimits,
            globalLimits: effective.globalLimits,
            effectiveLimits: effective.effectiveLimits,
        });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get user send limits", error });
    }
};
exports.getUserSendLimits = getUserSendLimits;
const updateUserSendLimits = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const targetUser = await User_model_1.default.findById(targetUserId).select("_id").lean();
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const body = req.body;
        const validationError = validateRateLimitBody(body);
        if (validationError) {
            res.status(400).json({ message: validationError });
            return;
        }
        const limits = (0, rate_limit_service_1.normalizeRateLimits)(body);
        const updated = await (0, rate_limit_service_1.upsertUserRateLimits)(targetUserId, limits);
        const effective = await (0, rate_limit_service_1.getEffectiveRateLimits)(targetUserId);
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.rate_limits.user.update",
            resourceType: "rate_limit",
            resourceId: targetUserId,
            targetUserId,
            status: "success",
            metadata: {
                userLimits: updated,
                effectiveLimits: effective.effectiveLimits,
            },
        });
        res.json({
            userLimits: updated,
            globalLimits: effective.globalLimits,
            effectiveLimits: effective.effectiveLimits,
        });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update user send limits", error });
    }
};
exports.updateUserSendLimits = updateUserSendLimits;
const getUserEmailAllocation = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const targetUser = await User_model_1.default.findById(targetUserId).select("_id").lean();
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const summary = await (0, email_allocation_service_1.getEmailAllocationSummary)(targetUserId);
        res.json(summary);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get user email package", error });
    }
};
exports.getUserEmailAllocation = getUserEmailAllocation;
const createUserEmailAllocation = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const targetUser = await User_model_1.default.findById(targetUserId).select("_id name email").lean();
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const body = req.body;
        const validationError = validateEmailAllocationBody(body);
        if (validationError) {
            res.status(400).json({ message: validationError });
            return;
        }
        const allocation = await (0, email_allocation_service_1.createEmailAllocation)({
            userId: targetUserId,
            assignedByUserId: req.userId,
            amountPaid: Number(body.amountPaid),
            currency: String(body.currency || "USD").trim().toUpperCase(),
            emailsPurchased: Number(body.emailsPurchased),
            paidAt: new Date(String(body.paidAt)),
            expiresAt: new Date(String(body.expiresAt)),
            receiptReference: String(body.receiptReference || "").trim() || undefined,
            note: String(body.note || "").trim() || undefined,
        });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.email_allocation.create",
            resourceType: "email_allocation",
            resourceId: allocation._id.toString(),
            targetUserId,
            status: "success",
            metadata: {
                amountPaid: allocation.amountPaid,
                currency: allocation.currency,
                emailsPurchased: allocation.emailsPurchased,
                paidAt: allocation.paidAt,
                expiresAt: allocation.expiresAt,
            },
        });
        const summary = await (0, email_allocation_service_1.getEmailAllocationSummary)(targetUserId);
        res.status(201).json(summary);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to create user email package", error });
    }
};
exports.createUserEmailAllocation = createUserEmailAllocation;
const suspendUserEmailAllocation = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const allocationId = Array.isArray(req.params.allocationId)
            ? req.params.allocationId[0]
            : req.params.allocationId;
        const targetUser = await User_model_1.default.findById(targetUserId).select("_id").lean();
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const body = req.body;
        const reason = String(body.reason || "").trim() || undefined;
        const allocation = await (0, email_allocation_service_1.suspendEmailAllocation)(allocationId, reason);
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.email_allocation.suspend",
            resourceType: "email_allocation",
            resourceId: allocation._id.toString(),
            targetUserId,
            status: "success",
            metadata: {
                reason: reason || "No reason provided",
            },
        });
        const summary = await (0, email_allocation_service_1.getEmailAllocationSummary)(targetUserId);
        res.status(200).json(summary);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to suspend email package", error });
    }
};
exports.suspendUserEmailAllocation = suspendUserEmailAllocation;
const updateUserEmailAllocation = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const allocationId = Array.isArray(req.params.allocationId)
            ? req.params.allocationId[0]
            : req.params.allocationId;
        const targetUser = await User_model_1.default.findById(targetUserId).select("_id").lean();
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const body = req.body;
        const emailsPurchased = Number(body.emailsPurchased);
        const note = String(body.note || "").trim() || undefined;
        const allocation = await (0, email_allocation_service_1.updateEmailAllocationPurchasedCount)({
            allocationId,
            userId: targetUserId,
            emailsPurchased,
            note,
        });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.email_allocation.update",
            resourceType: "email_allocation",
            resourceId: allocation._id.toString(),
            targetUserId,
            status: "success",
            metadata: {
                emailsPurchased: allocation.emailsPurchased,
            },
        });
        const summary = await (0, email_allocation_service_1.getEmailAllocationSummary)(targetUserId);
        res.status(200).json(summary);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Email allocation not found") {
            res.status(404).json({ message });
            return;
        }
        if (message.includes("emailsPurchased")) {
            res.status(400).json({ message });
            return;
        }
        res.status(500).json({ message: "Failed to update email package", error });
    }
};
exports.updateUserEmailAllocation = updateUserEmailAllocation;
const getAuditLogs = async (req, res) => {
    try {
        const startedAt = Date.now();
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
        const action = String(req.query.action || "").trim();
        const status = String(req.query.status || "").trim();
        const actorId = String(req.query.actorId || "").trim();
        const targetUserId = String(req.query.targetUserId || "").trim();
        const from = String(req.query.from || "").trim();
        const to = String(req.query.to || "").trim();
        const query = {};
        if (action)
            query.action = action;
        if (["success", "failure"].includes(status))
            query.status = status;
        if (actorId) {
            if (!mongoose_1.Types.ObjectId.isValid(actorId)) {
                res.status(400).json({ message: "Invalid actorId" });
                return;
            }
            query.actorId = new mongoose_1.Types.ObjectId(actorId);
        }
        if (targetUserId) {
            if (!mongoose_1.Types.ObjectId.isValid(targetUserId)) {
                res.status(400).json({ message: "Invalid targetUserId" });
                return;
            }
            query.targetUserId = new mongoose_1.Types.ObjectId(targetUserId);
        }
        if (from || to) {
            const createdAtFilter = {};
            if (from) {
                const fromDate = new Date(from);
                if (Number.isNaN(fromDate.getTime())) {
                    res.status(400).json({ message: "Invalid from date" });
                    return;
                }
                createdAtFilter.$gte = fromDate;
            }
            if (to) {
                const toDate = new Date(to);
                if (Number.isNaN(toDate.getTime())) {
                    res.status(400).json({ message: "Invalid to date" });
                    return;
                }
                createdAtFilter.$lte = toDate;
            }
            query.createdAt = createdAtFilter;
        }
        const [logs, total] = await Promise.all([
            AuditLog_model_1.default.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .maxTimeMS(5000)
                .lean(),
            AuditLog_model_1.default.countDocuments(query).maxTimeMS(5000),
        ]);
        const durationMs = Date.now() - startedAt;
        logger_1.logger.info("Audit logs fetched", {
            requestId: req.requestId,
            userId: req.userId,
            userRole: req.userRole,
            page,
            limit,
            total,
            resultCount: logs.length,
            durationMs,
            filters: {
                action: action || undefined,
                status: status || undefined,
                actorId: actorId || undefined,
                targetUserId: targetUserId || undefined,
                from: from || undefined,
                to: to || undefined,
            },
            slowQuery: durationMs > 1500,
        });
        res.json({
            logs,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    }
    catch (error) {
        logger_1.logger.error("Failed to get audit logs", {
            requestId: req.requestId,
            userId: req.userId,
            userRole: req.userRole,
            page: req.query.page,
            limit: req.query.limit,
            actorId: req.query.actorId,
            targetUserId: req.query.targetUserId,
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to get audit logs", error });
    }
};
exports.getAuditLogs = getAuditLogs;
// ─── Platform Domain CRUD ─────────────────────────────────────────────────────
const adminDeletePlatformDomain = async (req, res) => {
    try {
        const { id } = req.params;
        const domain = await SendingDomain_model_1.SendingDomain.findOneAndDelete({ _id: id, userId: null });
        if (!domain) {
            res.status(404).json({ message: "Platform domain not found." });
            return;
        }
        // Remove this domain from any users that had it assigned
        await User_model_1.default.updateMany({ assignedDomainIds: domain._id }, { $pull: { assignedDomainIds: domain._id } });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.platform_domain.delete",
            resourceType: "sending_domain",
            resourceId: String(id),
            status: "success",
            metadata: { domain: domain.domain },
        });
        res.json({ message: "Domain deleted." });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to delete platform domain", error });
    }
};
exports.adminDeletePlatformDomain = adminDeletePlatformDomain;
const getUserAssignedDomains = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const targetUser = await User_model_1.default.findById(targetUserId).select("_id assignedDomainIds").lean();
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const assignedIds = (targetUser.assignedDomainIds || []).map((id) => id.toString());
        // Return all platform domains with a flag indicating assignment
        const allPlatformDomains = await SendingDomain_model_1.SendingDomain.find({ userId: null })
            .select("_id domain isActive verificationStatus isDefault")
            .sort({ domain: 1 })
            .lean();
        const domains = allPlatformDomains.map((d) => ({
            _id: d._id.toString(),
            domain: d.domain,
            isActive: d.isActive,
            verificationStatus: d.verificationStatus,
            isDefault: d.isDefault,
            assigned: assignedIds.includes(d._id.toString()),
        }));
        res.json({ domains, assignedDomainIds: assignedIds });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get user assigned domains", error });
    }
};
exports.getUserAssignedDomains = getUserAssignedDomains;
const updateUserAssignedDomains = async (req, res) => {
    try {
        const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const targetUser = await User_model_1.default.findById(targetUserId);
        if (!targetUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const rawIds = req.body?.domainIds;
        if (!Array.isArray(rawIds)) {
            res.status(400).json({ message: "domainIds must be an array" });
            return;
        }
        const domainIds = rawIds.map((id) => String(id)).filter((id) => mongoose_1.Types.ObjectId.isValid(id));
        // Verify all provided IDs are valid platform (userId: null) domains
        const validDomains = await SendingDomain_model_1.SendingDomain.find({
            _id: { $in: domainIds.map((id) => new mongoose_1.Types.ObjectId(id)) },
            userId: null,
        }).select("_id").lean();
        const validIds = validDomains.map((d) => d._id);
        targetUser.assignedDomainIds = validIds;
        await targetUser.save();
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.user_domains.update",
            resourceType: "user",
            resourceId: targetUserId,
            targetUserId,
            status: "success",
            metadata: { assignedDomainIds: validIds.map((id) => id.toString()) },
        });
        res.json({ assignedDomainIds: validIds.map((id) => id.toString()) });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update user assigned domains", error });
    }
};
exports.updateUserAssignedDomains = updateUserAssignedDomains;
const extendUserEmailAllocation = async (req, res) => {
    try {
        const targetUserId = String(req.params.id);
        const allocationId = String(req.params.allocationId);
        const { newExpiresAt, note } = req.body;
        if (!newExpiresAt) {
            res.status(400).json({ message: "newExpiresAt is required" });
            return;
        }
        const updated = await (0, email_allocation_service_1.extendEmailAllocation)({
            allocationId,
            userId: targetUserId,
            newExpiresAt: new Date(newExpiresAt),
            note,
        });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.user_allocation.extend",
            resourceType: "user",
            resourceId: targetUserId,
            targetUserId,
            status: "success",
            metadata: { allocationId, newExpiresAt, status: updated.status },
        });
        const summary = await (0, email_allocation_service_1.getEmailAllocationSummary)(targetUserId);
        res.json({ message: "Allocation extended successfully", allocation: summary.currentAllocation });
    }
    catch (error) {
        res.status(400).json({ message: error.message || "Failed to extend allocation", error });
    }
};
exports.extendUserEmailAllocation = extendUserEmailAllocation;
const reconcileUserAllocation = async (req, res) => {
    try {
        const targetUserId = String(req.params.id);
        const allocation = await (0, email_allocation_service_1.getActiveEmailAllocation)(targetUserId);
        if (!allocation) {
            res.status(404).json({ message: "No active or recoverable allocation found for this user" });
            return;
        }
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.user_allocation.reconcile",
            resourceType: "user",
            resourceId: targetUserId,
            targetUserId,
            status: "success",
            metadata: {
                reservedEmails: allocation.reservedEmails,
                consumedEmails: allocation.consumedEmails,
                status: allocation.status,
            },
        });
        const summary = await (0, email_allocation_service_1.getEmailAllocationSummary)(targetUserId);
        res.json({ message: "Allocation reconciled successfully", allocation: summary.currentAllocation });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to reconcile user allocation", error });
    }
};
exports.reconcileUserAllocation = reconcileUserAllocation;
const adminReleaseCampaignPause = async (req, res) => {
    try {
        const { id } = req.params;
        const campaign = await Campaign_model_1.default.findById(id);
        if (!campaign) {
            res.status(404).json({ message: "Campaign not found" });
            return;
        }
        if (campaign.status !== "paused") {
            res.status(400).json({ message: "Campaign is not paused" });
            return;
        }
        await Campaign_model_1.default.findByIdAndUpdate(id, {
            $set: { pauseReason: "Pause released by admin" },
            $unset: { pausedBy: "" },
        });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.campaign.release_pause",
            resourceType: "campaign",
            resourceId: String(id),
            targetUserId: campaign.userId?.toString(),
            status: "success",
        });
        res.json({ message: "Campaign pause released. The user can now resume it." });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to release campaign pause", error });
    }
};
exports.adminReleaseCampaignPause = adminReleaseCampaignPause;
const adminPauseCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        const campaign = await Campaign_model_1.default.findById(id);
        if (!campaign) {
            res.status(404).json({ message: "Campaign not found" });
            return;
        }
        if (campaign.status !== "sending") {
            res.status(400).json({ message: "Campaign is not currently sending" });
            return;
        }
        await (0, campaign_dispatch_service_1.pauseCampaignAndReleaseQueue)(String(id), "Paused by admin", "admin");
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.campaign.pause",
            resourceType: "campaign",
            resourceId: String(id),
            targetUserId: campaign.userId?.toString(),
            status: "success",
        });
        res.json({ message: "Campaign paused by admin." });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to pause campaign", error });
    }
};
exports.adminPauseCampaign = adminPauseCampaign;
// ─── User Domain Verification ─────────────────────────────────────────────────
const adminListPendingUserDomains = async (_req, res) => {
    try {
        const pending = await SendingDomain_model_1.SendingDomain.find({
            userId: { $ne: null },
            verificationStatus: { $in: ["pending", "failed"] },
        })
            .sort({ createdAt: -1 })
            .lean();
        // Attach owner email for display
        const userIds = [...new Set(pending.map((d) => d.userId?.toString()).filter((id) => !!id))];
        const users = await User_model_1.default.find({ _id: { $in: userIds.map((id) => new mongoose_1.Types.ObjectId(id)) } }).select("_id email name").lean();
        const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));
        const result = pending.map((d) => ({
            ...d,
            owner: d.userId ? userMap[d.userId.toString()] : null,
        }));
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to list pending user domains", error });
    }
};
exports.adminListPendingUserDomains = adminListPendingUserDomains;
const adminVerifyUserDomain = async (req, res) => {
    try {
        const { id } = req.params;
        const domainId = Array.isArray(id) ? id[0] : id;
        const { action } = req.body; // "verify" | "reject"
        if (!["verify", "reject"].includes(action)) {
            res.status(400).json({ message: "action must be 'verify' or 'reject'" });
            return;
        }
        const domain = await SendingDomain_model_1.SendingDomain.findOne({ _id: domainId, userId: { $ne: null } });
        if (!domain) {
            res.status(404).json({ message: "User domain not found" });
            return;
        }
        if (action === "verify") {
            domain.verificationStatus = "verified";
            domain.isActive = true;
        }
        else {
            domain.verificationStatus = "failed";
            domain.isActive = false;
        }
        await domain.save();
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: `admin.user_domain.${action}`,
            resourceType: "sending_domain",
            resourceId: domainId,
            targetUserId: String(domain.userId),
            status: "success",
            metadata: { domain: domain.domain, action },
        });
        res.json({ message: `Domain ${action === "verify" ? "verified" : "rejected"}.`, domain });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update domain verification", error });
    }
};
exports.adminVerifyUserDomain = adminVerifyUserDomain;
const adminPauseAllUserCampaigns = async (req, res) => {
    try {
        const { id: userId } = req.params;
        const sendingCampaigns = await Campaign_model_1.default.find({ userId, status: "sending" }).select("_id").lean();
        if (sendingCampaigns.length === 0) {
            res.json({ message: "No active campaigns to pause.", paused: 0 });
            return;
        }
        await Promise.allSettled(sendingCampaigns.map((c) => (0, campaign_dispatch_service_1.pauseCampaignAndReleaseQueue)(c._id.toString(), "Paused by admin", "admin")));
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.user_campaigns.pause_all",
            resourceType: "user",
            resourceId: String(userId),
            targetUserId: String(userId),
            status: "success",
            metadata: { count: sendingCampaigns.length },
        });
        res.json({ message: `${sendingCampaigns.length} campaign(s) paused by admin.`, paused: sendingCampaigns.length });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to pause all campaigns", error });
    }
};
exports.adminPauseAllUserCampaigns = adminPauseAllUserCampaigns;
const adminRecoverCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        const campaign = await Campaign_model_1.default.findById(id);
        if (!campaign) {
            res.status(404).json({ message: "Campaign not found" });
            return;
        }
        if (!["sending", "paused"].includes(campaign.status)) {
            res.status(400).json({ message: "Campaign must be in sending or paused status to recover" });
            return;
        }
        // 1. Reset stalled/queued recipients back to pending
        const resetResult = await CampaignRecipient_model_1.default.updateMany({ campaignId: id, status: { $in: ["queued", "failed"] }, lastError: { $exists: true, $ne: null } }, { $set: { status: "pending", lastError: null }, $inc: { retryCount: -1 } });
        // 2. Reset S3 dispatch cursor so the list is re-scanned from the beginning
        await Campaign_model_1.default.findByIdAndUpdate(id, {
            $set: {
                status: "sending",
                pauseReason: null,
                dispatchCursorChunkIndex: 0,
                dispatchCursorRowOffset: 0,
                "stats.failed": 0,
            },
        });
        await (0, audit_log_service_1.logAuditFromRequest)(req, {
            action: "admin.campaign.recover",
            resourceType: "campaign",
            resourceId: String(id),
            targetUserId: campaign.userId?.toString(),
            status: "success",
            metadata: { recipientsReset: resetResult.modifiedCount },
        });
        res.json({
            message: "Campaign recovered. Dispatcher will pick it up on the next tick.",
            recipientsReset: resetResult.modifiedCount,
        });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to recover campaign", error });
    }
};
exports.adminRecoverCampaign = adminRecoverCampaign;
//# sourceMappingURL=admin.controller.js.map