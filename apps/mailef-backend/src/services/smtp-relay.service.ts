import { getRedisClient } from "../config/redis-client";
import { logger } from "../utils/logger";
import SmtpRelay, { type ISmtpRelay } from "../models/SmtpRelay.model";

export interface RuntimeSmtpRelay {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  tlsRejectUnauthorized: boolean;
  isSelfHosted: boolean;
  isActive: boolean;
  isArchived: boolean;
  weight: number;
  sentToday: number;
  usageDate: string;
  lastUsedAt: Date | null;
  notes: string;
  healthStatus: "unknown" | "healthy" | "degraded" | "down";
  consecutiveFailures: number;
  lastHealthCheckAt: Date | null;
}

export interface UpdatableSmtpRelayInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  secure?: boolean;
  tlsRejectUnauthorized?: boolean;
  isSelfHosted?: boolean;
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  secure?: boolean;
  tlsRejectUnauthorized?: boolean;
  isActive?: boolean;
  isArchived?: boolean;
  weight?: number;
  notes?: string;
}

export interface AdminSmtpRelayRow {
  _id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  secure: boolean;
  tlsRejectUnauthorized: boolean;
  isActive: boolean;
isSelfHosted: boolean;
  isActive: boolean;
  isArchived: boolean;
  weight: number;
  sentToday: number;
  lastUsedAt?: string;
  notes: string;
  passwordConfigured: boolean;
  healthStatus: "unknown" | "healthy" | "degraded" | "down";
  consecutiveFailures: number;
  lastHealthCheckAt?: string;
}

const getTodayKey = (): string => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Active relays cache (Redis, TTL-based)
// ---------------------------------------------------------------------------
const ACTIVE_RELAYS_CACHE_TTL_MS = 30_000; // 30 seconds

const getActiveRelaysCacheKey = (userId?: string | null): string =>
  `smtp:active_relays:${userId || 'platform'}`;

/**
 * Invalidates all cached active relay entries in Redis.
 * Called after any relay create/update/delete/toggle, or health status change.
 */
export const invalidateRelayCache = async (): Promise<void> => {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys("smtp:active_relays:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Cache invalidation is best-effort — stale entries expire via TTL.
  }
};

const normalizeRelay = (relay?: Partial<ISmtpRelay> | null): RuntimeSmtpRelay => {
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
    isSelfHosted: relay?.isSelfHosted === true,
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

export const toAdminSmtpRelayRow = (
  relay: RuntimeSmtpRelay
): AdminSmtpRelayRow => ({
  _id: relay.id,
  name: relay.name,
  host: relay.host,
  port: relay.port,
  username: relay.username,
  secure: relay.secure,
  tlsRejectUnauthorized: relay.tlsRejectUnauthorized,
  isSelfHosted: relay.isSelfHosted,
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

const resetDailyRelayUsageIfNeeded = async (): Promise<void> => {
  const today = getTodayKey();
  await SmtpRelay.updateMany(
    {
      $or: [{ usageDate: { $ne: today } }, { usageDate: { $exists: false } }],
    },
    {
      $set: {
        sentToday: 0,
        usageDate: today,
      },
    }
  );
};

export const listAdminSmtpRelays = async (): Promise<AdminSmtpRelayRow[]> => {
  await resetDailyRelayUsageIfNeeded();
  const relays = await SmtpRelay.find()
    .sort({ isArchived: 1, isActive: -1, weight: -1, name: 1 })
    .lean();

  return relays.map((relay) => toAdminSmtpRelayRow(normalizeRelay(relay)));
};

export const getActiveSmtpRelays = async (userId?: string | null): Promise<RuntimeSmtpRelay[]> => {
  // Try Redis cache first
  try {
    const redis = getRedisClient();
    const cacheKey = getActiveRelaysCacheKey(userId);
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed: RuntimeSmtpRelay[] = JSON.parse(cached, (_key, value) => {
        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          const d = new Date(value);
          return isNaN(d.getTime()) ? value : d;
        }
        return value;
      });
      return parsed;
    }
  } catch {
    // Cache miss or Redis unavailable — fall through to MongoDB
  }

  await resetDailyRelayUsageIfNeeded();
  const userRelays = userId
    ? await SmtpRelay.find({ isActive: true, isArchived: { $ne: true }, healthStatus: { $ne: "down" }, userId }).lean()
    : [];
  if (userRelays.length > 0) {
    const result = userRelays.map((relay) => normalizeRelay(relay));
    cacheActiveRelays(userId, result).catch(() => undefined);
    return result;
  }
  const relays = await SmtpRelay.find({ isActive: true, isArchived: { $ne: true }, healthStatus: { $ne: "down" }, userId: null }).lean();

  const result = relays.map((relay) => normalizeRelay(relay));

  cacheActiveRelays(userId, result).catch(() => undefined);
  return result;
};

/**
 * Stores the active relay list in Redis cache with TTL.
 * Fire-and-forget — errors are silently ignored.
 */
const cacheActiveRelays = async (userId: string | null | undefined, relays: RuntimeSmtpRelay[]): Promise<void> => {
  try {
    const redis = getRedisClient();
    const cacheKey = getActiveRelaysCacheKey(userId);
    await redis.setex(cacheKey, ACTIVE_RELAYS_CACHE_TTL_MS / 1000, JSON.stringify(relays));
  } catch {
    // Cache write failures are non-critical
  }
};

export const createSmtpRelay = async (
  input: UpdatableSmtpRelayInput
): Promise<AdminSmtpRelayRow> => {
  const relay = await SmtpRelay.create({
    name: input.name?.trim(),
    host: input.host?.trim().toLowerCase(),
    port: Math.max(Math.floor(Number(input.port) || 587), 1),
    username: input.username?.trim() || undefined,
    password: input.password?.trim() || undefined,
    secure: typeof input.secure === "boolean" ? input.secure : false,
    tlsRejectUnauthorized:
      typeof input.tlsRejectUnauthorized === "boolean"
        ? input.tlsRejectUnauthorized
        : true,
    isSelfHosted: input.isSelfHosted === true,
    isActive: typeof input.isActive === "boolean" ? input.isActive : true,
    isArchived: typeof input.isArchived === "boolean" ? input.isArchived : false,
    weight: Math.max(Math.floor(Number(input.weight) || 1), 1),
    notes: input.notes?.trim() || undefined,
    sentToday: 0,
    usageDate: getTodayKey(),
  });

  const result = toAdminSmtpRelayRow(normalizeRelay(relay.toObject()));
  await invalidateRelayCache().catch(() => undefined);
  return result;
};

export const updateSmtpRelay = async (
  id: string,
  input: UpdatableSmtpRelayInput
): Promise<AdminSmtpRelayRow | null> => {
  const existing = await SmtpRelay.findById(id);
  if (!existing) {
    return null;
  }

  if (input.name !== undefined) existing.name = input.name.trim() || existing.name;
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
  if (typeof input.secure === "boolean") existing.secure = input.secure;
  if (typeof input.tlsRejectUnauthorized === "boolean") {
    existing.tlsRejectUnauthorized = input.tlsRejectUnauthorized;
  }
  if (typeof input.isSelfHosted === "boolean") existing.isSelfHosted = input.isSelfHosted;
  if (typeof input.isActive === "boolean") existing.isActive = input.isActive;
  if (typeof input.isArchived === "boolean") existing.isArchived = input.isArchived;
  if (input.weight !== undefined) {
    existing.weight = Math.max(Math.floor(Number(input.weight) || existing.weight), 1);
  }
  if (input.notes !== undefined) {
    existing.notes = input.notes.trim() || undefined;
  }

  await existing.save();
  const result = toAdminSmtpRelayRow(normalizeRelay(existing.toObject()));
  await invalidateRelayCache().catch(() => undefined);
  return result;
};

export const setSmtpRelayActiveState = async (
  id: string,
  isActive: boolean
): Promise<AdminSmtpRelayRow | null> => {
  const relay = await SmtpRelay.findByIdAndUpdate(id, { isActive }, {
    returnDocument: "after",
  }).lean();
  if (!relay) return null;
  await invalidateRelayCache().catch(() => undefined);
  return toAdminSmtpRelayRow(normalizeRelay(relay));
};

export const setSmtpRelayArchivedState = async (
  id: string,
  isArchived: boolean
): Promise<AdminSmtpRelayRow | null> => {
  const relay = await SmtpRelay.findByIdAndUpdate(id, { isArchived }, {
    returnDocument: "after",
  }).lean();
  if (!relay) return null;
  await invalidateRelayCache().catch(() => undefined);
  return toAdminSmtpRelayRow(normalizeRelay(relay));
};

export const deleteSmtpRelay = async (id: string): Promise<boolean> => {
  const result = await SmtpRelay.findByIdAndDelete(id).lean();
  await invalidateRelayCache().catch(() => undefined);
  return Boolean(result);
};

export const markSmtpRelayUsed = async (id: string): Promise<void> => {
  await SmtpRelay.findByIdAndUpdate(id, {
    $inc: { sentToday: 1 },
    $set: { lastUsedAt: new Date(), usageDate: getTodayKey() },
  }).catch(() => undefined);
};
