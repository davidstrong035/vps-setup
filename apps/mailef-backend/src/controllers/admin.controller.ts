import { Response } from "express";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import Campaign from "../models/Campaign.model";
import CampaignRecipient from "../models/CampaignRecipient.model";
import List from "../models/List.model";
import Subscriber from "../models/Subscriber.model";
import Template from "../models/Template.model";
import User from "../models/User.model";
import AuditLog from "../models/AuditLog.model";
import { SendingDomain } from "../models/SendingDomain.model";
import { logAuditFromRequest } from "../services/audit-log.service";
import { pauseCampaignAndReleaseQueue } from "../services/campaign-dispatch.service";
import { sendEmail, verifyMailProvider } from "../services/mailer.service";
import { logger } from "../utils/logger";
import {
  createEmailAllocation,
  extendEmailAllocation,
  getActiveEmailAllocation,
  getEmailAllocationSummary,
  suspendEmailAllocation,
  updateEmailAllocationPurchasedCount,
} from "../services/email-allocation.service";
import {
  getPlatformDispatchSettings,
  getPlatformMailSettings,
  toAdminMailSettings,
  updatePlatformDispatchSettings,
  updatePlatformMailSettings,
} from "../services/platform-settings.service";
import {
  createSmtpRelay,
  deleteSmtpRelay,
  listAdminSmtpRelays,
  setSmtpRelayActiveState,
  setSmtpRelayArchivedState,
  updateSmtpRelay,
} from "../services/smtp-relay.service";
import { AuthRequest } from "../types";
import {
  getEffectiveRateLimits,
  getGlobalRateLimits,
  getUserRateLimits,
  normalizeRateLimits,
  upsertGlobalRateLimits,
  upsertUserRateLimits,
} from "../services/rate-limit.service";
import { getGlobalQuotaUsage } from "../services/global-quota-usage.service";
import { buildHealthStatus } from "../services/monitoring.service";

const validateRateLimitBody = (body: Record<string, unknown>) => {
  const fields = ["perMinute", "perHour", "perDay"];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") continue;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      return `${field} must be a positive integer or empty`;
    }
  }

  return null;
};

const validateEmailAllocationBody = (body: Record<string, unknown>) => {
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

const validatePlatformMailSettingsBody = (body: Record<string, unknown>) => {
  if (
    body.provider !== undefined &&
    body.provider !== "ses" &&
    body.provider !== "smtp"
  ) {
    return "provider must be either ses or smtp";
  }

  if (
    body.defaultFromName !== undefined &&
    typeof body.defaultFromName !== "string"
  ) {
    return "defaultFromName must be a string";
  }

  if (
    body.verifiedFromEmail !== undefined &&
    typeof body.verifiedFromEmail !== "string"
  ) {
    return "verifiedFromEmail must be a string";
  }

  if (
    body.configurationSetName !== undefined &&
    typeof body.configurationSetName !== "string"
  ) {
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

  if (
    body.smtpPort !== undefined &&
    body.smtpPort !== null &&
    body.smtpPort !== ""
  ) {
    const smtpPort = Number(body.smtpPort);
    if (
      !Number.isFinite(smtpPort) ||
      !Number.isInteger(smtpPort) ||
      smtpPort < 1 ||
      smtpPort > 65535
    ) {
      return "smtpPort must be a valid TCP port";
    }
  }

  if (body.smtpSecure !== undefined && typeof body.smtpSecure !== "boolean") {
    return "smtpSecure must be a boolean";
  }

  if (
    body.smtpTlsRejectUnauthorized !== undefined &&
    typeof body.smtpTlsRejectUnauthorized !== "boolean"
  ) {
    return "smtpTlsRejectUnauthorized must be a boolean";
  }

  const verifiedFromEmail = String(body.verifiedFromEmail || "").trim();
  if (verifiedFromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedFromEmail)) {
    return "verifiedFromEmail must be a valid email address";
  }

  return null;
};

const validatePlatformDispatchSettingsBody = (body: Record<string, unknown>) => {
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return "enabled must be a boolean";
  }

  const numericFields: Array<{ key: string; min: number }> = [
    { key: "intervalMs", min: 2000 },
    { key: "usersPerTick", min: 1 },
    { key: "maxPerRun", min: 100 },
    { key: "workerConcurrency", min: 1 },
    { key: "workerRateLimitMax", min: 1 },
    { key: "workerRateLimitDurationMs", min: 100 },
  ];

  for (const field of numericFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field.key)) continue;
    const raw = body[field.key];
    if (raw === undefined || raw === null || raw === "") continue;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < field.min || !Number.isInteger(parsed)) {
      return `${field.key} must be an integer greater than or equal to ${field.min}`;
    }
  }

  return null;
};

const validateSmtpRelayBody = (
  body: Record<string, unknown>,
  options: { partial?: boolean } = {}
) => {
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

  if (
    body.tlsRejectUnauthorized !== undefined &&
    typeof body.tlsRejectUnauthorized !== "boolean"
  ) {
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

const extractSmtpRelayInput = (body: Record<string, unknown>) => ({
  name: body.name !== undefined ? String(body.name || "").trim() : undefined,
  host: body.host !== undefined ? String(body.host || "").trim() : undefined,
  port:
    body.port !== undefined && body.port !== null && body.port !== ""
      ? Number(body.port)
      : undefined,
  username:
    body.username !== undefined ? String(body.username || "").trim() : undefined,
  password: body.password !== undefined ? String(body.password) : undefined,
  secure: typeof body.secure === "boolean" ? body.secure : undefined,
  tlsRejectUnauthorized:
    typeof body.tlsRejectUnauthorized === "boolean"
      ? body.tlsRejectUnauthorized
      : undefined,
  isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
  isArchived: typeof body.isArchived === "boolean" ? body.isArchived : undefined,
  weight:
    body.weight !== undefined && body.weight !== null && body.weight !== ""
      ? Number(body.weight)
      : undefined,
  notes: body.notes !== undefined ? String(body.notes || "") : undefined,
});

export const getAdminOverview = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      usersTotal,
      adminsTotal,
      activeUsers,
      campaignsTotal,
      listsTotal,
      templatesTotal,
      subscribersTotal,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: { $in: ["admin", "super_admin"] } }),
      User.countDocuments({ isActive: true }),
      Campaign.countDocuments({}),
      List.countDocuments({}),
      Template.countDocuments({}),
      Subscriber.countDocuments({}),
    ]);

    const sentAgg = await Campaign.aggregate([
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
  } catch (error) {
    res.status(500).json({ message: "Failed to get admin overview", error });
  }
};

export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const search = String(req.query.search || "").trim();
    const role = String(req.query.role || "all").trim();
    const status = String(req.query.status || "all").trim();
    const sortBy = String(req.query.sortBy || "createdAt").trim();
    const sortOrder = String(req.query.sortOrder || "desc").trim() === "asc" ? 1 : -1;

    const query: Record<string, unknown> = {};

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
    } else if (status === "disabled") {
      query.isActive = false;
    }

    const allowedSortFields = new Set(["createdAt", "name", "email", "role"]);
    const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "createdAt";

    const [users, total] = await Promise.all([
      User.find(query)
      .select("_id name email role isActive createdAt")
      .sort({ [safeSortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
      User.countDocuments(query),
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
  } catch (error) {
    res.status(500).json({ message: "Failed to get users", error });
  }
};

export const updateUserAccess = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const { role, isActive } = req.body as {
      role?: "user" | "admin" | "super_admin";
      isActive?: boolean;
    };

    // Resolve actor role from the database, not the JWT, for all privilege checks.
    const actorRecord = await User.findById(req.userId).select("role").lean();
    const actorRole = actorRecord?.role ?? "user";

    if (role !== undefined && !["user", "admin", "super_admin"].includes(role)) {
      await logAuditFromRequest(req, {
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
      await logAuditFromRequest(req, {
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

    const targetUser = await User.findById(targetUserId);
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

    if (role !== undefined) targetUser.role = role;
    if (isActive !== undefined) targetUser.isActive = isActive;

    await targetUser.save();

    await logAuditFromRequest(req, {
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
  } catch (error) {
    res.status(500).json({ message: "Failed to update user", error });
  }
};

export const resetUserPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { newPassword } = req.body as { newPassword?: string };

    if (!newPassword || String(newPassword).length < 6) {
      res.status(400).json({ message: "New password must be at least 6 characters" });
      return;
    }

    const actorRecord = await User.findById(req.userId).select("role").lean();
    const actorRole = actorRecord?.role ?? "user";

    if (actorRole !== "admin" && actorRole !== "super_admin") {
      await logAuditFromRequest(req, {
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

    const targetUser = await User.findById(targetUserId);
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

    await logAuditFromRequest(req, {
      action: "admin.user_password.reset",
      resourceType: "user",
      resourceId: targetUser._id.toString(),
      targetUserId: targetUser._id.toString(),
      status: "success",
      metadata: { email: targetUser.email },
    });

    res.json({ message: `Password reset for ${targetUser.email}` });
  } catch (error) {
    res.status(500).json({ message: "Failed to reset password", error });
  }
};

export const createAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: "admin" | "super_admin";
    };
    // Always verify the actor's role from the database — never trust the JWT
    // claim alone for a privilege-sensitive operation like this.
    const actorRecord = await User.findById(req.userId).select("role").lean();
    const actorRole = actorRecord?.role ?? "user";

    // Resolve the requested role — treat anything other than the literal
    // string "super_admin" as "admin" so no invalid value can escalate.
    const requestedRole: "admin" | "super_admin" =
      role === "super_admin" ? "super_admin" : "admin";

    // Hard gate checked against the live DB role, not the JWT claim.
    if (requestedRole === "super_admin" && actorRole !== "super_admin") {
      await logAuditFromRequest(req, {
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
      await logAuditFromRequest(req, {
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
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) {
      await logAuditFromRequest(req, {
        action: "admin.account.create",
        resourceType: "user",
        status: "failure",
        metadata: { reason: "email_already_in_use", email: normalizedEmail },
      });
      res.status(409).json({ message: "Email already in use" });
      return;
    }

    const hashed = await bcrypt.hash(password, 12);
    const admin = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password: hashed,
      role: requestedRole,
      isActive: true,
    });

    await logAuditFromRequest(req, {
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
  } catch (error) {
    res.status(500).json({ message: "Failed to create admin", error });
  }
};

export const getUserStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUser = await User.findById(req.params.id)
      .select("_id name email role isActive createdAt")
      .lean();

    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const [campaignsTotal, listsTotal, templatesTotal, subscribersTotal] = await Promise.all([
      Campaign.countDocuments({ userId: targetUser._id }),
      List.countDocuments({ userId: targetUser._id }),
      Template.countDocuments({ userId: targetUser._id }),
      Subscriber.countDocuments({ userId: targetUser._id }),
    ]);

    const campaignSums = await Campaign.aggregate([
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

    const recentCampaigns = await Campaign.find({ userId: targetUser._id })
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
  } catch (error) {
    res.status(500).json({ message: "Failed to get user stats", error });
  }
};

export const getGlobalSendLimits = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const limits = await getGlobalRateLimits();
    res.json({ limits });
  } catch (error) {
    res.status(500).json({ message: "Failed to get global send limits", error });
  }
};

export const getGlobalQuotaUsageHandler = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const usage = await getGlobalQuotaUsage();
    res.json({ usage });
  } catch (error) {
    res.status(500).json({ message: "Failed to get global quota usage", error });
  }
};

export const getSystemHealthHandler = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const health = await buildHealthStatus();
    res.json(health);
  } catch (error) {
    res.status(500).json({ message: "Failed to get system health", error });
  }
};

export const getPlatformMailSettingsForAdmin = async (
  _req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const mailSettings = await getPlatformMailSettings();
    res.json({ mailSettings: toAdminMailSettings(mailSettings) });
  } catch (error) {
    res.status(500).json({ message: "Failed to get platform mail settings", error });
  }
};

export const testPlatformMailSettingsForAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
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
    const smtpPort =
      body.smtpPort !== undefined && body.smtpPort !== null && body.smtpPort !== ""
        ? Number(body.smtpPort)
        : undefined;
    const smtpUsername = String(body.smtpUsername || "").trim();
    const smtpPassword =
      body.smtpPassword !== undefined ? String(body.smtpPassword) : undefined;
    const smtpSecure = body.smtpSecure === true;
    const smtpTlsRejectUnauthorized =
      typeof body.smtpTlsRejectUnauthorized === "boolean"
        ? body.smtpTlsRejectUnauthorized
        : undefined;
    const connectionOnly = body.connectionOnly === true;
    const to = String(body.to || "").trim();

    if (!connectionOnly && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res.status(400).json({ message: "A valid test recipient email is required" });
      return;
    }

    await verifyMailProvider({
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
      messageId = await sendEmail(
        {
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
          fromEmail:
            verifiedFromEmail ||
            process.env.MAIL_FROM_EMAIL?.trim() ||
            process.env.SMTP_FROM_EMAIL?.trim() ||
            process.env.SES_FROM_EMAIL?.trim() ||
            "",
        },
        {
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
        }
      );
    }

    await logAuditFromRequest(req, {
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
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : "Failed to test mail provider",
    });
  }
};

export const updatePlatformMailSettingsForAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const validationError = validatePlatformMailSettingsBody(body);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const mailSettings = await updatePlatformMailSettings({
      provider:
        body.provider === "smtp"
          ? "smtp"
          : body.provider === "ses"
            ? "ses"
            : undefined,
      defaultFromName: String(body.defaultFromName || "").trim(),
      verifiedFromEmail: String(body.verifiedFromEmail || "").trim(),
      configurationSetName: String(body.configurationSetName || "").trim(),
      smtpHost: String(body.smtpHost || "").trim(),
      smtpPort:
        body.smtpPort !== undefined && body.smtpPort !== null && body.smtpPort !== ""
          ? Number(body.smtpPort)
          : undefined,
      smtpUsername: String(body.smtpUsername || "").trim(),
      smtpPassword:
        body.smtpPassword !== undefined ? String(body.smtpPassword) : undefined,
      smtpSecure:
        typeof body.smtpSecure === "boolean" ? body.smtpSecure : undefined,
      smtpTlsRejectUnauthorized:
        typeof body.smtpTlsRejectUnauthorized === "boolean"
          ? body.smtpTlsRejectUnauthorized
          : undefined,
    });

    await logAuditFromRequest(req, {
      action: "admin.mail_settings.update",
      resourceType: "platform_settings",
      resourceId: "platform",
      status: "success",
      metadata: { mailSettings: toAdminMailSettings(mailSettings) },
    });

    res.json({ mailSettings: toAdminMailSettings(mailSettings) });
  } catch (error) {
    res.status(500).json({ message: "Failed to update platform mail settings", error });
  }
};

export const getSmtpRelaysForAdmin = async (
  _req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const relays = await listAdminSmtpRelays();
    res.json({ relays });
  } catch (error) {
    res.status(500).json({ message: "Failed to get SMTP relays", error });
  }
};

export const createSmtpRelayForAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const validationError = validateSmtpRelayBody(body);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const relay = await createSmtpRelay(extractSmtpRelayInput(body));

    await logAuditFromRequest(req, {
      action: "admin.smtp_relay.create",
      resourceType: "smtp_relay",
      resourceId: relay._id,
      status: "success",
      metadata: { relay },
    });

    res.status(201).json({ relay });
  } catch (error) {
    res.status(500).json({ message: "Failed to create SMTP relay", error });
  }
};

export const updateSmtpRelayForAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const relayId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = req.body as Record<string, unknown>;
    const validationError = validateSmtpRelayBody(body, { partial: true });
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const relay = await updateSmtpRelay(relayId, extractSmtpRelayInput(body));
    if (!relay) {
      res.status(404).json({ message: "SMTP relay not found" });
      return;
    }

    await logAuditFromRequest(req, {
      action: "admin.smtp_relay.update",
      resourceType: "smtp_relay",
      resourceId: relay._id,
      status: "success",
      metadata: { relay },
    });

    res.json({ relay });
  } catch (error) {
    res.status(500).json({ message: "Failed to update SMTP relay", error });
  }
};

export const setSmtpRelayActiveStateForAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const relayId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (typeof req.body?.isActive !== "boolean") {
      res.status(400).json({ message: "isActive must be a boolean" });
      return;
    }

    const relay = await setSmtpRelayActiveState(relayId, req.body.isActive);
    if (!relay) {
      res.status(404).json({ message: "SMTP relay not found" });
      return;
    }

    res.json({ relay });
  } catch (error) {
    res.status(500).json({ message: "Failed to update SMTP relay status", error });
  }
};

export const setSmtpRelayArchivedStateForAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const relayId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (typeof req.body?.isArchived !== "boolean") {
      res.status(400).json({ message: "isArchived must be a boolean" });
      return;
    }

    const relay = await setSmtpRelayArchivedState(relayId, req.body.isArchived);
    if (!relay) {
      res.status(404).json({ message: "SMTP relay not found" });
      return;
    }

    res.json({ relay });
  } catch (error) {
    res.status(500).json({ message: "Failed to archive SMTP relay", error });
  }
};

export const deleteSmtpRelayForAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const relayId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const deleted = await deleteSmtpRelay(relayId);

    if (!deleted) {
      res.status(404).json({ message: "SMTP relay not found" });
      return;
    }

    await logAuditFromRequest(req, {
      action: "admin.smtp_relay.delete",
      resourceType: "smtp_relay",
      resourceId: relayId,
      status: "success",
    });

    res.json({ message: "SMTP relay deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete SMTP relay", error });
  }
};

export const getPlatformDispatchSettingsForAdmin = async (
  _req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const dispatchSettings = await getPlatformDispatchSettings();
    res.json({ dispatchSettings });
  } catch (error) {
    res.status(500).json({ message: "Failed to get platform dispatch settings", error });
  }
};

export const updatePlatformDispatchSettingsForAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const validationError = validatePlatformDispatchSettingsBody(body);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const dispatchSettings = await updatePlatformDispatchSettings({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      intervalMs:
        body.intervalMs !== undefined && body.intervalMs !== null && body.intervalMs !== ""
          ? Number(body.intervalMs)
          : undefined,
      usersPerTick:
        body.usersPerTick !== undefined && body.usersPerTick !== null && body.usersPerTick !== ""
          ? Number(body.usersPerTick)
          : undefined,
      maxPerRun:
        body.maxPerRun !== undefined && body.maxPerRun !== null && body.maxPerRun !== ""
          ? Number(body.maxPerRun)
          : undefined,
      workerConcurrency:
        body.workerConcurrency !== undefined &&
        body.workerConcurrency !== null &&
        body.workerConcurrency !== ""
          ? Number(body.workerConcurrency)
          : undefined,
      workerRateLimitMax:
        body.workerRateLimitMax !== undefined &&
        body.workerRateLimitMax !== null &&
        body.workerRateLimitMax !== ""
          ? Number(body.workerRateLimitMax)
          : undefined,
      workerRateLimitDurationMs:
        body.workerRateLimitDurationMs !== undefined &&
        body.workerRateLimitDurationMs !== null &&
        body.workerRateLimitDurationMs !== ""
          ? Number(body.workerRateLimitDurationMs)
          : undefined,
    });

    await logAuditFromRequest(req, {
      action: "admin.dispatch_settings.update",
      resourceType: "platform_settings",
      resourceId: "platform",
      status: "success",
      metadata: { dispatchSettings },
    });

    res.json({ dispatchSettings });
  } catch (error) {
    res.status(500).json({ message: "Failed to update platform dispatch settings", error });
  }
};

export const updateGlobalSendLimits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const validationError = validateRateLimitBody(body);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const limits = normalizeRateLimits(body);
    const updated = await upsertGlobalRateLimits(limits);

    await logAuditFromRequest(req, {
      action: "admin.rate_limits.global.update",
      resourceType: "rate_limit",
      resourceId: "global",
      status: "success",
      metadata: { limits: updated },
    });

    res.json({ limits: updated });
  } catch (error) {
    res.status(500).json({ message: "Failed to update global send limits", error });
  }
};

export const getUserSendLimits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const targetUser = await User.findById(targetUserId).select("_id").lean();
    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const [userLimits, effective] = await Promise.all([
      getUserRateLimits(targetUserId),
      getEffectiveRateLimits(targetUserId),
    ]);

    res.json({
      userLimits,
      globalLimits: effective.globalLimits,
      effectiveLimits: effective.effectiveLimits,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get user send limits", error });
  }
};

export const updateUserSendLimits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const targetUser = await User.findById(targetUserId).select("_id").lean();
    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const validationError = validateRateLimitBody(body);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const limits = normalizeRateLimits(body);
    const updated = await upsertUserRateLimits(targetUserId, limits);
    const effective = await getEffectiveRateLimits(targetUserId);

    await logAuditFromRequest(req, {
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
  } catch (error) {
    res.status(500).json({ message: "Failed to update user send limits", error });
  }
};

export const getUserEmailAllocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const targetUser = await User.findById(targetUserId).select("_id").lean();
    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const summary = await getEmailAllocationSummary(targetUserId);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: "Failed to get user email package", error });
  }
};

export const createUserEmailAllocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const targetUser = await User.findById(targetUserId).select("_id name email").lean();
    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const validationError = validateEmailAllocationBody(body);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const allocation = await createEmailAllocation({
      userId: targetUserId,
      assignedByUserId: req.userId!,
      amountPaid: Number(body.amountPaid),
      currency: String(body.currency || "USD").trim().toUpperCase(),
      emailsPurchased: Number(body.emailsPurchased),
      paidAt: new Date(String(body.paidAt)),
      expiresAt: new Date(String(body.expiresAt)),
      receiptReference: String(body.receiptReference || "").trim() || undefined,
      note: String(body.note || "").trim() || undefined,
    });

    await logAuditFromRequest(req, {
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

    const summary = await getEmailAllocationSummary(targetUserId);
    res.status(201).json(summary);
  } catch (error) {
    res.status(500).json({ message: "Failed to create user email package", error });
  }
};

export const suspendUserEmailAllocation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const allocationId = Array.isArray(req.params.allocationId)
      ? req.params.allocationId[0]
      : req.params.allocationId;

    const targetUser = await User.findById(targetUserId).select("_id").lean();
    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const reason = String(body.reason || "").trim() || undefined;

    const allocation = await suspendEmailAllocation(allocationId, reason);

    await logAuditFromRequest(req, {
      action: "admin.email_allocation.suspend",
      resourceType: "email_allocation",
      resourceId: allocation._id.toString(),
      targetUserId,
      status: "success",
      metadata: {
        reason: reason || "No reason provided",
      },
    });

    const summary = await getEmailAllocationSummary(targetUserId);
    res.status(200).json(summary);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to suspend email package", error });
  }
};

export const updateUserEmailAllocation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const allocationId = Array.isArray(req.params.allocationId)
      ? req.params.allocationId[0]
      : req.params.allocationId;

    const targetUser = await User.findById(targetUserId).select("_id").lean();
    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const emailsPurchased = Number(body.emailsPurchased);
    const note = String(body.note || "").trim() || undefined;

    const allocation = await updateEmailAllocationPurchasedCount({
      allocationId,
      userId: targetUserId,
      emailsPurchased,
      note,
    });

    await logAuditFromRequest(req, {
      action: "admin.email_allocation.update",
      resourceType: "email_allocation",
      resourceId: allocation._id.toString(),
      targetUserId,
      status: "success",
      metadata: {
        emailsPurchased: allocation.emailsPurchased,
      },
    });

    const summary = await getEmailAllocationSummary(targetUserId);
    res.status(200).json(summary);
  } catch (error: any) {
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

export const getAuditLogs = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const query: Record<string, unknown> = {};
    if (action) query.action = action;
    if (["success", "failure"].includes(status)) query.status = status;
    if (actorId) {
      if (!Types.ObjectId.isValid(actorId)) {
        res.status(400).json({ message: "Invalid actorId" });
        return;
      }

      query.actorId = new Types.ObjectId(actorId);
    }

    if (targetUserId) {
      if (!Types.ObjectId.isValid(targetUserId)) {
        res.status(400).json({ message: "Invalid targetUserId" });
        return;
      }

      query.targetUserId = new Types.ObjectId(targetUserId);
    }

    if (from || to) {
      const createdAtFilter: Record<string, Date> = {};

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
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .maxTimeMS(5000)
        .lean(),
      AuditLog.countDocuments(query).maxTimeMS(5000),
    ]);

    const durationMs = Date.now() - startedAt;
    logger.info("Audit logs fetched", {
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
  } catch (error) {
    logger.error("Failed to get audit logs", {
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

// ─── Platform Domain CRUD ─────────────────────────────────────────────────────

export const adminDeletePlatformDomain = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const domain = await SendingDomain.findOneAndDelete({ _id: id, userId: null });
    if (!domain) {
      res.status(404).json({ message: "Platform domain not found." });
      return;
    }

    // Remove this domain from any users that had it assigned
    await User.updateMany(
      { assignedDomainIds: domain._id },
      { $pull: { assignedDomainIds: domain._id } }
    );

    await logAuditFromRequest(req, {
      action: "admin.platform_domain.delete",
      resourceType: "sending_domain",
      resourceId: String(id),
      status: "success",
      metadata: { domain: domain.domain },
    });

    res.json({ message: "Domain deleted." });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete platform domain", error });
  }
};

export const getUserAssignedDomains = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const targetUser = await User.findById(targetUserId).select("_id assignedDomainIds").lean();
    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const assignedIds = (targetUser.assignedDomainIds || []).map((id) => id.toString());

    // Return all platform domains with a flag indicating assignment
    const allPlatformDomains = await SendingDomain.find({ userId: null })
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
  } catch (error) {
    res.status(500).json({ message: "Failed to get user assigned domains", error });
  }
};

export const updateUserAssignedDomains = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const rawIds = req.body?.domainIds;
    if (!Array.isArray(rawIds)) {
      res.status(400).json({ message: "domainIds must be an array" });
      return;
    }

    const domainIds = rawIds.map((id) => String(id)).filter((id) => Types.ObjectId.isValid(id));

    // Verify all provided IDs are valid platform (userId: null) domains
    const validDomains = await SendingDomain.find({
      _id: { $in: domainIds.map((id) => new Types.ObjectId(id)) },
      userId: null,
    }).select("_id").lean();

    const validIds = validDomains.map((d) => d._id);

    targetUser.assignedDomainIds = validIds as any;
    await targetUser.save();

    await logAuditFromRequest(req, {
      action: "admin.user_domains.update",
      resourceType: "user",
      resourceId: targetUserId,
      targetUserId,
      status: "success",
      metadata: { assignedDomainIds: validIds.map((id) => id.toString()) },
    });

    res.json({ assignedDomainIds: validIds.map((id) => id.toString()) });
  } catch (error) {
    res.status(500).json({ message: "Failed to update user assigned domains", error });
  }
};

export const extendUserEmailAllocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = String(req.params.id);
    const allocationId = String(req.params.allocationId);
    const { newExpiresAt, note } = req.body;

    if (!newExpiresAt) {
      res.status(400).json({ message: "newExpiresAt is required" });
      return;
    }

    const updated = await extendEmailAllocation({
      allocationId,
      userId: targetUserId,
      newExpiresAt: new Date(newExpiresAt),
      note,
    });

    await logAuditFromRequest(req, {
      action: "admin.user_allocation.extend",
      resourceType: "user",
      resourceId: targetUserId,
      targetUserId,
      status: "success",
      metadata: { allocationId, newExpiresAt, status: updated.status },
    });

    const summary = await getEmailAllocationSummary(targetUserId);
    res.json({ message: "Allocation extended successfully", allocation: summary.currentAllocation });
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to extend allocation", error });
  }
};

export const reconcileUserAllocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = String(req.params.id);
    const allocation = await getActiveEmailAllocation(targetUserId);

    if (!allocation) {
      res.status(404).json({ message: "No active or recoverable allocation found for this user" });
      return;
    }

    await logAuditFromRequest(req, {
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

    const summary = await getEmailAllocationSummary(targetUserId);
    res.json({ message: "Allocation reconciled successfully", allocation: summary.currentAllocation });
  } catch (error) {
    res.status(500).json({ message: "Failed to reconcile user allocation", error });
  }
};

export const adminReleaseCampaignPause = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found" });
      return;
    }
    if (campaign.status !== "paused") {
      res.status(400).json({ message: "Campaign is not paused" });
      return;
    }

    await Campaign.findByIdAndUpdate(id, {
      $set: { pauseReason: "Pause released by admin" },
      $unset: { pausedBy: "" },
    });

    await logAuditFromRequest(req, {
      action: "admin.campaign.release_pause",
      resourceType: "campaign",
      resourceId: String(id),
      targetUserId: campaign.userId?.toString(),
      status: "success",
    });

    res.json({ message: "Campaign pause released. The user can now resume it." });
  } catch (error) {
    res.status(500).json({ message: "Failed to release campaign pause", error });
  }
};

export const adminPauseCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found" });
      return;
    }
    if (campaign.status !== "sending") {
      res.status(400).json({ message: "Campaign is not currently sending" });
      return;
    }

    await pauseCampaignAndReleaseQueue(String(id), "Paused by admin", "admin");

    await logAuditFromRequest(req, {
      action: "admin.campaign.pause",
      resourceType: "campaign",
      resourceId: String(id),
      targetUserId: campaign.userId?.toString(),
      status: "success",
    });

    res.json({ message: "Campaign paused by admin." });
  } catch (error) {
    res.status(500).json({ message: "Failed to pause campaign", error });
  }
};

// ─── User Domain Verification ─────────────────────────────────────────────────

export const adminListPendingUserDomains = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pending = await SendingDomain.find({
      userId: { $ne: null },
      verificationStatus: { $in: ["pending", "failed"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Attach owner email for display
    const userIds = [...new Set(pending.map((d) => d.userId?.toString()).filter((id): id is string => !!id))];
    const users = await User.find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } }).select("_id email name").lean();
    const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));

    const result = pending.map((d) => ({
      ...d,
      owner: d.userId ? userMap[d.userId.toString()] : null,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to list pending user domains", error });
  }
};

export const adminVerifyUserDomain = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const domainId = Array.isArray(id) ? id[0] : id;
    const { action } = req.body; // "verify" | "reject"

    if (!["verify", "reject"].includes(action)) {
      res.status(400).json({ message: "action must be 'verify' or 'reject'" });
      return;
    }

    const domain = await SendingDomain.findOne({ _id: domainId, userId: { $ne: null } });
    if (!domain) {
      res.status(404).json({ message: "User domain not found" });
      return;
    }

    if (action === "verify") {
      domain.verificationStatus = "verified";
      domain.isActive = true;
    } else {
      domain.verificationStatus = "failed";
      domain.isActive = false;
    }

    await domain.save();

    await logAuditFromRequest(req, {
      action: `admin.user_domain.${action}`,
      resourceType: "sending_domain",
      resourceId: domainId,
      targetUserId: String(domain.userId),
      status: "success",
      metadata: { domain: domain.domain, action },
    });

    res.json({ message: `Domain ${action === "verify" ? "verified" : "rejected"}.`, domain });
  } catch (error) {
    res.status(500).json({ message: "Failed to update domain verification", error });
  }
};

export const adminPauseAllUserCampaigns = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.params;
    const sendingCampaigns = await Campaign.find({ userId, status: "sending" }).select("_id").lean();

    if (sendingCampaigns.length === 0) {
      res.json({ message: "No active campaigns to pause.", paused: 0 });
      return;
    }

    await Promise.allSettled(
      sendingCampaigns.map((c) =>
        pauseCampaignAndReleaseQueue(c._id.toString(), "Paused by admin", "admin")
      )
    );

    await logAuditFromRequest(req, {
      action: "admin.user_campaigns.pause_all",
      resourceType: "user",
      resourceId: String(userId),
      targetUserId: String(userId),
      status: "success",
      metadata: { count: sendingCampaigns.length },
    });

    res.json({ message: `${sendingCampaigns.length} campaign(s) paused by admin.`, paused: sendingCampaigns.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to pause all campaigns", error });
  }
};

export const adminRecoverCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found" });
      return;
    }

    if (![ "sending", "paused" ].includes(campaign.status)) {
      res.status(400).json({ message: "Campaign must be in sending or paused status to recover" });
      return;
    }

    // 1. Reset stalled/queued recipients back to pending
    const resetResult = await CampaignRecipient.updateMany(
      { campaignId: id, status: { $in: ["queued", "failed"] }, lastError: { $exists: true, $ne: null } },
      { $set: { status: "pending", lastError: null }, $inc: { retryCount: -1 } }
    );

    // 2. Reset S3 dispatch cursor so the list is re-scanned from the beginning
    await Campaign.findByIdAndUpdate(id, {
      $set: {
        status: "sending",
        pauseReason: null,
        dispatchCursorChunkIndex: 0,
        dispatchCursorRowOffset: 0,
        "stats.failed": 0,
      },
    });

    await logAuditFromRequest(req, {
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
  } catch (error) {
    res.status(500).json({ message: "Failed to recover campaign", error });
  }
};