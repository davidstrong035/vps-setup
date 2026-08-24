import crypto from "crypto";
import { Response } from "express";
import jwt from "jsonwebtoken";
import AuditLog from "../models/AuditLog.model";
import User from "../models/User.model";
import { logAuditEvent, logAuditFromRequest } from "../services/audit-log.service";
import { getEmailAllocationSummary, getUserEmailAllocationHistory } from "../services/email-allocation.service";
import { getPlatformMailSettings } from "../services/platform-settings.service";
import { getAvailableSendingDomainNames } from "../services/sending-domain.service";
import { sendEmail } from "../services/mailer.service";
import { AuthRequest } from "../types";

const signToken = (userId: string, role: "user" | "admin" | "super_admin"): string =>
  jwt.sign({ userId, role }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  } as jwt.SignOptions);

export const register = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      await logAuditFromRequest(req, {
        action: "auth.register",
        resourceType: "user",
        status: "failure",
        metadata: { reason: "missing_required_fields" },
      });
      res.status(400).json({ message: "Name, email and password are required" });
      return;
    }

    const existing = await User.findOne({ email });
    if (existing) {
      await logAuditFromRequest(req, {
        action: "auth.register",
        resourceType: "user",
        status: "failure",
        metadata: { reason: "email_already_in_use", email: String(email).trim().toLowerCase() },
      });
      res.status(409).json({ message: "Email already in use" });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const assignedRole: "user" | "admin" | "super_admin" = "user";

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role: assignedRole,
      isActive: true,
    });
    const token = signToken(user._id.toString(), user.role || assignedRole);

    await logAuditFromRequest(req, {
      action: "auth.register",
      resourceType: "user",
      resourceId: user._id.toString(),
      targetUserId: user._id.toString(),
      status: "success",
      metadata: { email: user.email, role: user.role },
    });

    res.status(201).json({ token, user });
  } catch (error) {
    await logAuditFromRequest(req, {
      action: "auth.register",
      resourceType: "user",
      status: "failure",
      metadata: { reason: "server_error" },
    });
    res.status(500).json({ message: "Registration failed", error });
  }
};

export const login = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      await logAuditFromRequest(req, {
        action: "auth.login",
        resourceType: "user",
        status: "failure",
        metadata: { reason: "missing_credentials" },
      });
      res.status(400).json({ message: "Email and password are required" });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      await logAuditFromRequest(req, {
        action: "auth.login",
        resourceType: "user",
        status: "failure",
        metadata: { reason: "invalid_credentials", email: normalizedEmail },
      });
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }

    if (user.isActive === false) {
      await logAuditEvent({
        actorType: "user",
        actorId: user._id.toString(),
        actorRole: user.role,
        action: "auth.login",
        resourceType: "user",
        resourceId: user._id.toString(),
        targetUserId: user._id.toString(),
        status: "failure",
        requestId: req.requestId,
        ipAddress: req.requestIp,
        userAgent: req.requestUserAgent,
        metadata: { reason: "account_disabled", email: normalizedEmail },
      });
      res.status(403).json({ message: "Account is disabled. Contact admin." });
      return;
    }

    const effectiveRole: "user" | "admin" | "super_admin" = user.role || "user";

    if (user.isActive === undefined) {
      user.isActive = true;
    }

    const token = signToken(user._id.toString(), effectiveRole);

    await logAuditEvent({
      actorType: "user",
      actorId: user._id.toString(),
      actorRole: effectiveRole,
      action: "auth.login",
      resourceType: "user",
      resourceId: user._id.toString(),
      targetUserId: user._id.toString(),
      status: "success",
      requestId: req.requestId,
      ipAddress: req.requestIp,
      userAgent: req.requestUserAgent,
      metadata: { email: normalizedEmail },
    });

    res.json({ token, user });
  } catch (error) {
    await logAuditFromRequest(req, {
      action: "auth.login",
      resourceType: "user",
      status: "failure",
      metadata: { reason: "server_error" },
    });
    res.status(500).json({ message: "Login failed", error });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: "Failed to get user", error });
  }
};

export const getMyEmailAllocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const summary = await getEmailAllocationSummary(req.userId);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: "Failed to get email package", error });
  }
};

export const getMyEmailAllocationHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

    const history = await getUserEmailAllocationHistory(req.userId, page, limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: "Failed to get email package history", error });
  }
};

export const getMyEmailActivity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {
      $or: [{ actorId: req.userId }, { targetUserId: req.userId }],
      action: {
        $in: [
          "auth.login",
          "campaign.create",
          "campaign.send",
          "campaign.scheduled_dispatch",
          "admin.email_allocation.create",
          "admin.email_allocation.suspend",
        ],
      },
    };

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await AuditLog.countDocuments(filter);
    const hasMore = skip + logs.length < total;

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        hasMore,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get email activity", error });
  }
};

export const getMyMailSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [mailSettings, sendingDomains] = await Promise.all([
      getPlatformMailSettings(),
      getAvailableSendingDomainNames(),
    ]);

    res.json({
      mailSettings: {
        provider: mailSettings.provider,
        defaultFromName: mailSettings.defaultFromName,
        verifiedFromEmail: mailSettings.verifiedFromEmail,
        configurationSetName: mailSettings.configurationSetName,
        defaultSendingDomain: sendingDomains.defaultDomain,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get mail settings", error });
  }
};

export const forgotPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ message: "Email is required" });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    // Always respond the same whether or not the email exists (don't leak accounts)
    if (!user) {
      res.json({
        message:
          "If an account exists for that email, a password reset link has been sent.",
      });
      return;
    }

    // Admins cannot reset their password via the forgot-password route.
    // Only another admin can reset an admin's password via the admin panel.
    if (user.role === "admin" || user.role === "super_admin") {
      res.json({
        message:
          "If an account exists for that email, a password reset link has been sent.",
      });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${process.env.CLIENT_URL || "http://localhost:5173"}/reset-password?token=${resetToken}`;
    const fromName = "Maileff Support";
    const fromEmail =
      process.env.MAIL_FROM_EMAIL?.trim() ||
      process.env.SES_FROM_EMAIL?.trim() ||
      "no-reply@maileff.space";

    try {
      await sendEmail({
        to: user.email,
        subject: "Reset your Maileff password",
        fromName,
        fromEmail,
        html: `
          <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#f5f5f5;padding:40px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
              <tr><td style="background:#2563eb;height:6px;font-size:1px;line-height:1px;">&nbsp;</td></tr>
              <tr><td style="padding:36px 36px 28px;">
                <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;">Reset your password</h1>
                <p style="margin:0 0 18px;font-size:15px;line-height:22px;color:#333;">Hello ${user.name},</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:22px;color:#333;">
                  We received a request to reset your Maileff password. Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:6px;background:#2563eb;">
                      <a href="${resetUrl}" target="_blank" style="display:inline-block;padding:12px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Reset Password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 18px;font-size:13px;line-height:18px;color:#666;">If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="margin:0 0 18px;font-size:13px;line-height:18px;color:#2563eb;word-break:break-all;">${resetUrl}</p>
                <p style="margin:0;font-size:13px;line-height:18px;color:#666;">If you didn't request this, you can safely ignore this email.</p>
              </td></tr>
              <tr><td style="padding:18px 36px;background:#f9fafb;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">
                &copy; ${new Date().getFullYear()} Maileff. All rights reserved.
              </td></tr>
            </table>
          </div>
        `,
      });
    } catch (mailError) {
      // Clear the token if email fails so it can't be used
      user.passwordResetToken = null;
      user.passwordResetExpires = null;
      await user.save();
      console.error("Failed to send password reset email:", mailError);
      res.status(500).json({ message: "Failed to send password reset email. Please try again later." });
      return;
    }

    await logAuditEvent({
      actorType: "system",
      action: "auth.forgot_password",
      resourceType: "user",
      resourceId: user._id.toString(),
      targetUserId: user._id.toString(),
      status: "success",
      requestId: req.requestId,
      ipAddress: req.requestIp,
      userAgent: req.requestUserAgent,
      metadata: { email: user.email },
    });

    res.json({
      message:
        "If an account exists for that email, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Failed to process password reset request" });
  }
};

export const resetPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({ message: "Token and new password are required" });
      return;
    }

    if (String(password).length < 6) {
      res.status(400).json({ message: "Password must be at least 6 characters" });
      return;
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(String(token))
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      res.status(400).json({ message: "Invalid or expired reset token" });
      return;
    }

    user.password = String(password);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    await logAuditEvent({
      actorType: "user",
      actorId: user._id.toString(),
      actorRole: user.role,
      action: "auth.reset_password",
      resourceType: "user",
      resourceId: user._id.toString(),
      targetUserId: user._id.toString(),
      status: "success",
      requestId: req.requestId,
      ipAddress: req.requestIp,
      userAgent: req.requestUserAgent,
      metadata: { email: user.email },
    });

    res.json({ message: "Password has been reset. You can now sign in." });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Failed to reset password" });
  }
};
