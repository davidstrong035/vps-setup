import { Response } from "express";
import { Schema, Types } from "mongoose";
import { AuthRequest } from "../types";
import { SendingDomain } from "../models/SendingDomain.model";
import SmtpRelay from "../models/SmtpRelay.model";
import User from "../models/User.model";
import { getNextAllowedSendTime } from "../services/next-send-time.service";
import { getLastSentTime } from "../services/last-sent-time.service";

const normalizeDomain = (value: unknown): string =>
  String(value || "")
    .trim()
    .toLowerCase();

const isValidDomain = (value: string): boolean =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    value
  );

const getRequestUserId = (req: AuthRequest): Types.ObjectId => {
  if (!req.userId) throw new Error("Unauthorized");
  return new Types.ObjectId(req.userId);
};

// ─── Sending Domains ──────────────────────────────────────────────────────────

export const listUserDomains = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);

  // Fetch the user's assigned platform domain IDs
  const userRecord = await User.findById(userId).select("assignedDomainIds").lean();
  const assignedIds = (userRecord?.assignedDomainIds || []).map((id) => id.toString());

  if (assignedIds.length === 0) {
    res.json([]);
    return;
  }

  const domains = await SendingDomain.find({
    _id: { $in: assignedIds },
    userId: null,
  })
    .sort({ isDefault: -1, domain: 1 })
    .select("domain isActive isDefault verificationStatus")
    .lean();

  res.json(domains);
};

export const createUserDomain = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const normalizedDomain = normalizeDomain(req.body.domain);

  if (!isValidDomain(normalizedDomain)) {
    res.status(400).json({ message: "Please provide a valid domain name." });
    return;
  }

  const existing = await SendingDomain.findOne({ domain: normalizedDomain });
  if (existing) {
    res.status(409).json({ message: "This domain is already registered." });
    return;
  }

  if (req.body.isDefault === true) {
    await SendingDomain.updateMany({ userId }, { $set: { isDefault: false } });
  }

  const domain = new SendingDomain({
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

export const deleteUserDomain = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const id = req.params.id;

  const domain = await SendingDomain.findOneAndDelete({ _id: id, userId });
  if (!domain) {
    res.status(404).json({ message: "Domain not found." });
    return;
  }

  // Delete the associated relay if one exists for this user/domain
  const domainStr = domain.domain;
  await SmtpRelay.deleteMany({ userId, notes: `auto:${domainStr}` });

  res.json({ message: "Domain deleted." });
};

export const setUserDefaultDomain = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const id = req.params.id;

  const target = await SendingDomain.findOne({ _id: id, userId });
  if (!target) {
    res.status(404).json({ message: "Domain not found." });
    return;
  }

  if (target.verificationStatus !== "verified") {
    res.status(400).json({ message: "Only verified domains can be set as default." });
    return;
  }

  await SendingDomain.updateMany({ userId }, { $set: { isDefault: false } });
  target.isDefault = true;
  await target.save();

  res.json(target);
};

// ─── SMTP Relays (per-user) ───────────────────────────────────────────────────

export const listUserRelays = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const relays = await SmtpRelay.find({ userId })
    .sort({ isActive: -1, createdAt: -1 })
    .select("-password")
    .lean();
  res.json(
    relays.map((r) => ({
      ...r,
      passwordConfigured: Boolean((r as { password?: string }).password),
    }))
  );
};

export const createUserRelay = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const { name, host, port, username, password, secure, tlsRejectUnauthorized, notes } =
    req.body;

  if (!host || !port) {
    res.status(400).json({ message: "host and port are required." });
    return;
  }

  const relay = new SmtpRelay({
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

export const updateUserRelay = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const id = req.params.id;
  const allowed = ["name", "host", "port", "username", "password", "secure", "tlsRejectUnauthorized", "isActive", "notes"];
  const updates: Record<string, unknown> = {};

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates[key] = req.body[key];
    }
  }

  if (!updates.password) {
    delete updates.password; // don't wipe password if not provided
  }

  const relay = await SmtpRelay.findOneAndUpdate(
    { _id: id, userId },
    { $set: updates },
    { returnDocument: "after" }
  );

  if (!relay) {
    res.status(404).json({ message: "Relay not found." });
    return;
  }

  const relayObj = relay.toObject() as unknown as Record<string, unknown>;
  delete relayObj.password;
  res.json({ ...relayObj, passwordConfigured: Boolean(relay.password) });
};

export const deleteUserRelay = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const id = req.params.id;

  const relay = await SmtpRelay.findOneAndDelete({ _id: id, userId });
  if (!relay) {
    res.status(404).json({ message: "Relay not found." });
    return;
  }

  res.json({ message: "Relay deleted." });
};

// ─── Link relay to domain ─────────────────────────────────────────────────────

export const linkRelayToDomain = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const { domainId, relayId } = req.body;

  if (!Types.ObjectId.isValid(domainId) || !Types.ObjectId.isValid(relayId)) {
    res.status(400).json({ message: "Invalid domainId or relayId." });
    return;
  }

  const [domain, relay] = await Promise.all([
    SendingDomain.findOne({ _id: domainId, userId }),
    SmtpRelay.findOne({ _id: relayId, userId }),
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
  (domain.smtpRelayIds as unknown as string[]) = [relayId];
  await domain.save();

  res.json(domain);
};

// ─── Next Send Time ─────────────────────────────────────────────────────────

export const getUserNextSendTime = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const next = await getNextAllowedSendTime(userId.toString());
  res.json({ nextSendTime: next });
};

export const getUserSendTimes = async (req: AuthRequest, res: Response) => {
  const userId = getRequestUserId(req);
  const [lastSent, nextSend] = await Promise.all([
    getLastSentTime(userId.toString()),
    getNextAllowedSendTime(userId.toString()),
  ]);
  res.json({ lastSentTime: lastSent, nextSendTime: nextSend });
};
