import nodemailer from "nodemailer";
import SmtpRelay from "../models/SmtpRelay.model";
import { getActiveSmtpRelays, invalidateRelayCache, type RuntimeSmtpRelay } from "./smtp-relay.service";
import { getRelayHealthCheckSettings } from "./platform-settings.service";
import { logger } from "../utils/logger";

// Config
const HEALTH_CHECK_INTERVAL_MS = Math.max(
  Number(process.env.RELAY_HEALTH_CHECK_INTERVAL_MS) || 300_000,
  10_000
);
const HEALTH_CHECK_TIMEOUT_MS = Math.max(
  Number(process.env.RELAY_HEALTH_CHECK_TIMEOUT_MS) || 10_000,
  2_000
);
const MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN = Math.max(
  Number(process.env.RELAY_MAX_FAILURES_BEFORE_DOWN) || 3,
  1
);
const MAX_CONSECUTIVE_FAILURES_BEFORE_DEGRADED = Math.max(
  Number(process.env.RELAY_MAX_FAILURES_BEFORE_DEGRADED) || 1,
  1
);
const CONSECUTIVE_SUCCESSES_TO_RECOVER = Math.max(
  Number(process.env.RELAY_SUCCESSES_TO_RECOVER) || 2,
  1
);

let healthCheckTimer: NodeJS.Timeout | null = null;
// Cache the intervals from DB so we don't query on every tick
let cachedSelfHostedIntervalMs = 300_000;
let cachedThirdPartyIntervalMs = 14_400_000;
let intervalCacheExpiresAt = 0;

const getRelayIntervalMs = async (relay: {
  isSelfHosted?: boolean;
  healthStatus?: string | null;
  lastHealthCheckAt?: Date | null;
}): Promise<number> => {
  if (relay.healthStatus === "down" || relay.healthStatus === "degraded") {
    return 300_000;
  }
  if (Date.now() > intervalCacheExpiresAt) {
    try {
      const settings = await getRelayHealthCheckSettings();
      cachedSelfHostedIntervalMs = settings.selfHostedIntervalSec * 1000;
      cachedThirdPartyIntervalMs = settings.thirdPartyIntervalSec * 1000;
      intervalCacheExpiresAt = Date.now() + 300_000;
    } catch {}
  }
  return relay.isSelfHosted ? cachedSelfHostedIntervalMs : cachedThirdPartyIntervalMs;
};

const isRelayDueForCheck = async (relay: {
  isSelfHosted?: boolean;
  healthStatus?: string | null;
  lastHealthCheckAt?: Date | null;
}): Promise<boolean> => {
  const intervalMs = await getRelayIntervalMs(relay);
  if (!relay.lastHealthCheckAt) return true;
  const elapsed = Date.now() - new Date(relay.lastHealthCheckAt).getTime();
  return elapsed >= intervalMs;
};

const buildTransporterForRelay = (relay: RuntimeSmtpRelay): nodemailer.Transporter => {
  const secure = relay.secure || relay.port === 465;
  return nodemailer.createTransport({
    host: relay.host,
    port: relay.port,
    secure,
    connectionTimeout: HEALTH_CHECK_TIMEOUT_MS,
    greetingTimeout: HEALTH_CHECK_TIMEOUT_MS,
    socketTimeout: HEALTH_CHECK_TIMEOUT_MS,
    ...(relay.username ? { auth: { user: relay.username, pass: relay.password || "" } } : {}),
    ...(relay.tlsRejectUnauthorized === false
      ? { tls: { rejectUnauthorized: false } }
      : {}),
  });
};

/**
 * Checks a single relay's SMTP connectivity by attempting to open a connection
 * and verify the transport. Returns true if healthy, false if not.
 */
const checkRelay = async (relay: RuntimeSmtpRelay): Promise<boolean> => {
  try {
    const transport = buildTransporterForRelay(relay);
    await transport.verify();
    transport.close();
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Updates a relay's health status based on the result of a health check.
 * Auto-deactivates if consecutive failures exceed the threshold.
 */
const applyHealthResult = async (
  relayId: string,
  isHealthy: boolean,
  relayName: string,
  relayHost: string
): Promise<void> => {
  const relay = await SmtpRelay.findById(relayId);
  if (!relay) return;

  if (isHealthy) {
    // Reset consecutive failures on success
    const newConsecutive = 0;
    let newStatus: "healthy" | "degraded" = "healthy";

    // If it was previously down/degraded, it needs CONSECUTIVE_SUCCESSES_TO_RECOVER successes
    // before being marked healthy again. Use a separate counter for the recovery check.
    if (relay.healthStatus === "down" || relay.healthStatus === "degraded") {
      // Track recovery attempts in a transient way: we increment recovery progress
      // stored temporarily (we use consecutiveFailures as a recovery counter when healing)
      const recoveryProgress = Math.max(relay.consecutiveFailures, 0) + 1;
      if (recoveryProgress >= CONSECUTIVE_SUCCESSES_TO_RECOVER) {
        newStatus = "healthy";
        logger.info("Relay recovered and marked healthy", {
          relayId,
          relayName,
          host: relayHost,
          previousStatus: relay.healthStatus,
        });
      } else {
        newStatus = "degraded";
      }
      relay.consecutiveFailures = recoveryProgress;
    } else {
      relay.consecutiveFailures = 0;
    }

    relay.healthStatus = newStatus;
    relay.lastHealthCheckAt = new Date();

    // If it was previously auto-deactivated and now healthy, reactivate it
    if (!relay.isActive && relay.healthStatus === "healthy") {
      relay.isActive = true;
      logger.info("Relay auto-reactivated after recovering health", {
        relayId,
        relayName,
        host: relayHost,
      });
    }

    await relay.save();
    invalidateRelayCache().catch(() => undefined);
  } else {
    // Failed health check
    const newConsecutive = (relay.consecutiveFailures || 0) + 1;
    let newStatus: "degraded" | "down" = "degraded";

    if (newConsecutive >= MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN) {
      newStatus = "down";
    }

    relay.healthStatus = newStatus;
    relay.consecutiveFailures = newConsecutive;
    relay.lastHealthCheckAt = new Date();

    // Auto-deactivate if down
    if (newStatus === "down" && relay.isActive) {
      relay.isActive = false;
      logger.warn("Relay auto-deactivated due to health check failures", {
        relayId,
        relayName,
        host: relayHost,
        consecutiveFailures: newConsecutive,
        threshold: MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN,
      });
    }

    await relay.save();
    invalidateRelayCache().catch(() => undefined);
  }
};

/**
 * Marks a relay failure from a live send attempt (not a health check probe).
 * This is called by the mailer when sending through a relay fails.
 */
export const recordRelaySendFailure = async (relayId: string): Promise<void> => {
  try {
    const relay = await SmtpRelay.findById(relayId);
    if (!relay) return;

    const newConsecutive = (relay.consecutiveFailures || 0) + 1;
    let newStatus: "degraded" | "down" = "degraded";

    if (newConsecutive >= MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN) {
      newStatus = "down";
    }

    // Only auto-deactivate on send failure if it's a hard failure
    if (newStatus === "down" && relay.isActive) {
      relay.isActive = false;
      logger.warn("Relay auto-deactivated due to send failure", {
        relayId,
        relayName: relay.name,
        host: relay.host,
        consecutiveFailures: newConsecutive,
      });
    }

    relay.healthStatus = newStatus;
    relay.consecutiveFailures = newConsecutive;
    relay.lastHealthCheckAt = new Date();
    await relay.save();
    invalidateRelayCache().catch(() => undefined);
  } catch (error) {
    logger.error("Failed to record relay send failure", { relayId, error });
  }
};

/**
 * Marks a relay send success. Resets consecutive failures.
 */
export const recordRelaySendSuccess = async (relayId: string): Promise<void> => {
  try {
    await SmtpRelay.findByIdAndUpdate(relayId, {
      $set: {
        consecutiveFailures: 0,
        healthStatus: "healthy",
        lastHealthCheckAt: new Date(),
      },
    });
    invalidateRelayCache().catch(() => undefined);
  } catch (error) {
    logger.error("Failed to record relay send success", { relayId, error });
  }
};

/**
 * Runs one full health check cycle: checks all non-archived relays,
 * updates statuses, auto-deactivates down relays.
 */
const runHealthCheckTick = async (): Promise<void> => {
  try {
    // Check all non-archived relays (including inactive ones that might have recovered)
    const relays = await SmtpRelay.find({ isArchived: { $ne: true } }).lean();

    if (relays.length === 0) return;

    for (const relay of relays) {
      // Skip relays whose interval hasn't elapsed yet
      // Down/degraded relays are checked more frequently to detect recovery
      const isDue = await isRelayDueForCheck({
        isSelfHosted: relay.isSelfHosted === true,
        healthStatus: relay.healthStatus,
        lastHealthCheckAt: relay.lastHealthCheckAt,
      });
      if (!isDue) continue;

      const runtimeRelay = {
        id: relay._id.toString(),
        name: relay.name,
        host: relay.host,
        port: relay.port,
        username: relay.username || "",
        password: relay.password || "",
        secure: relay.secure || false,
        tlsRejectUnauthorized: relay.tlsRejectUnauthorized !== false,
        isSelfHosted: relay.isSelfHosted === true,
        isActive: relay.isActive,
        isArchived: relay.isArchived,
        weight: relay.weight,
        sentToday: relay.sentToday,
        usageDate: relay.usageDate || "",
        lastUsedAt: relay.lastUsedAt || null,
        notes: relay.notes || "",
        healthStatus: (relay.healthStatus || "unknown") as "unknown" | "healthy" | "degraded" | "down",
        consecutiveFailures: relay.consecutiveFailures || 0,
        lastHealthCheckAt: relay.lastHealthCheckAt || null,
      };

      const isHealthy = await checkRelay(runtimeRelay);
      await applyHealthResult(
        runtimeRelay.id,
        isHealthy,
        runtimeRelay.name,
        runtimeRelay.host
      );
    }
  } catch (error) {
    logger.error("Relay health check tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const startRelayHealthChecker = (): void => {
  if (healthCheckTimer) return;

  logger.info("Starting relay health checker", {
    baseTickIntervalMs: BASE_TICK_INTERVAL_MS,
    maxFailuresBeforeDown: MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN,
  });

  // Run immediately on start
  runHealthCheckTick().catch((error) => {
    logger.error("Initial relay health check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  healthCheckTimer = setInterval(() => {
    runHealthCheckTick().catch((error) => {
      logger.error("Relay health check tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, BASE_TICK_INTERVAL_MS);
};

export const stopRelayHealthChecker = (): void => {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    logger.info("Relay health checker stopped");
  }
};