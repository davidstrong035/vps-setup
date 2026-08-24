import mongoose from "mongoose";
import { mailDeadLetterQueue } from "../queue/mail.dead-letter.queue";
import Campaign from "../models/Campaign.model";
import SmtpRelay from "../models/SmtpRelay.model";
import { getGlobalQuotaUsage } from "./global-quota-usage.service";
import { logger } from "../utils/logger";

// Config
const MONITOR_INTERVAL_MS = Math.max(
  Number(process.env.MONITOR_INTERVAL_MS) || 120_000,
  10_000
);

const DLQ_ALERT_THRESHOLD = Math.max(
  Number(process.env.MONITOR_DLQ_ALERT_THRESHOLD) || 50,
  1
);

const STUCK_CAMPAIGN_ALERT_MINUTES = Math.max(
  Number(process.env.MONITOR_STUCK_CAMPAIGN_MINUTES) || 30,
  5
);

const HIGH_BOUNCE_RATE_THRESHOLD = Math.max(
  Number(process.env.MONITOR_BOUNCE_THRESHOLD_PERCENT) || 5,
  1
);

let monitorTimer: NodeJS.Timeout | null = null;

export interface SystemHealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  database: { connected: boolean };
  redis: { connected: boolean };
  smtpRelays: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
    autoDeactivated: number;
  };
  queues: {
    pending: number;
    deadLetter: number;
  };
  campaigns: {
    stuck: number;
    sending: number;
    paused: number;
    total: number;
  };
  globalQuota: {
    perMinute: { used: number; limit: number | undefined } | null;
    perHour: { used: number; limit: number | undefined } | null;
    perDay: { used: number; limit: number | undefined } | null;
  } | null;
  alerts: string[];
}

const isRedisConnected = (): boolean => {
  try {
    const { getRedisClient } = require("../config/redis-client");
    const redis = getRedisClient();
    return redis.status === "ready";
  } catch {
    return false;
  }
};

const buildHealthStatus = async (): Promise<SystemHealthStatus> => {
  const alerts: string[] = [];

  // Database
  const dbConnected = mongoose.connection.readyState === 1;

  // Redis
  const redisConnected = isRedisConnected();

  // SMTP Relays
  const relays = await SmtpRelay.find({ isArchived: { $ne: true } }).lean();
  const healthyRelays = relays.filter((r) => r.healthStatus === "healthy");
  const degradedRelays = relays.filter((r) => r.healthStatus === "degraded");
  const downRelays = relays.filter((r) => r.healthStatus === "down");
  const autoDeactivated = relays.filter((r) => !r.isActive && r.consecutiveFailures > 0);

  if (downRelays.length > 0) {
    alerts.push(
      `${downRelays.length} SMTP relay(s) are DOWN and auto-deactivated. Check logs.`
    );
  }

  if (degradedRelays.length > 0) {
    alerts.push(
      `${degradedRelays.length} SMTP relay(s) are in degraded state.`
    );
  }

  // Queues
  const pendingJobs = await mailDeadLetterQueue.getWaitingCount().catch(() => 0);
  // For DLQ size, we count completed+failed as approximations
  const dlqMeta = await mailDeadLetterQueue.getJobCounts().catch(() => ({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  }));
  const deadLetterCount = dlqMeta.waiting + dlqMeta.active + dlqMeta.delayed;

  if (deadLetterCount > DLQ_ALERT_THRESHOLD) {
    alerts.push(
      `Dead Letter Queue has ${deadLetterCount} items (threshold: ${DLQ_ALERT_THRESHOLD}). Review failed emails.`
    );
  }

  // Campaigns stuck in "sending" state
  const stuckThreshold = new Date(Date.now() - STUCK_CAMPAIGN_ALERT_MINUTES * 60 * 1000);
  const stuckCampaigns = await Campaign.countDocuments({
    status: "sending",
    updatedAt: { $lt: stuckThreshold },
  }).catch(() => 0);

  if (stuckCampaigns > 0) {
    alerts.push(
      `${stuckCampaigns} campaign(s) stuck in "sending" for over ${STUCK_CAMPAIGN_ALERT_MINUTES} minutes. Check dispatcher health.`
    );
  }

  const sendingCampaigns = await Campaign.countDocuments({ status: "sending" }).catch(() => 0);
  const pausedCampaigns = await Campaign.countDocuments({ status: "paused" }).catch(() => 0);
  const totalCampaigns = await Campaign.countDocuments({}).catch(() => 0);

  // Bounce rate check
  const recentCampaigns = await Campaign.find({
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  })
    .select("stats")
    .lean()
    .catch(() => []);

  let totalSent = 0;
  let totalBounced = 0;
  for (const c of recentCampaigns) {
    totalSent += c.stats?.sent || 0;
    totalBounced += c.stats?.bounced || 0;
  }

  if (totalSent > 0) {
    const bounceRate = (totalBounced / totalSent) * 100;
    if (bounceRate > HIGH_BOUNCE_RATE_THRESHOLD) {
      alerts.push(
        `High bounce rate in the last 24 hours: ${bounceRate.toFixed(1)}% (threshold: ${HIGH_BOUNCE_RATE_THRESHOLD}%). Check sending domain health.`
      );
    }
  }

  // Global quota usage
  let globalQuota = null;
  try {
    const usage = await getGlobalQuotaUsage();
    globalQuota = {
      perMinute:
        usage.perMinute.limit !== undefined
          ? { used: usage.perMinute.used, limit: usage.perMinute.limit }
          : null,
      perHour:
        usage.perHour.limit !== undefined
          ? { used: usage.perHour.used, limit: usage.perHour.limit }
          : null,
      perDay:
        usage.perDay.limit !== undefined
          ? { used: usage.perDay.used, limit: usage.perDay.limit }
          : null,
    };

    if (usage.perDay.limit !== undefined && usage.perDay.remaining === 0) {
      alerts.push("Global daily send limit has been reached. No sends until the day resets.");
    }
  } catch {
    globalQuota = null;
  }

  // Determine overall status
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (!dbConnected || !redisConnected || deadLetterCount > DLQ_ALERT_THRESHOLD * 3) {
    status = "unhealthy";
  } else if (
    downRelays.length > 0 ||
    degradedRelays.length > 0 ||
    stuckCampaigns > 0 ||
    deadLetterCount > DLQ_ALERT_THRESHOLD
  ) {
    status = "degraded";
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    database: { connected: dbConnected },
    redis: { connected: redisConnected },
    smtpRelays: {
      total: relays.length,
      healthy: healthyRelays.length,
      degraded: degradedRelays.length,
      down: downRelays.length,
      autoDeactivated: autoDeactivated.length,
    },
    queues: {
      pending: pendingJobs,
      deadLetter: deadLetterCount,
    },
    campaigns: {
      stuck: stuckCampaigns,
      sending: sendingCampaigns,
      paused: pausedCampaigns,
      total: totalCampaigns,
    },
    globalQuota,
    alerts,
  };
};

export { buildHealthStatus };

const runMonitorCycle = async (): Promise<void> => {
  try {
    const health = await buildHealthStatus();
    logger.info("System health monitor cycle", {
      status: health.status,
      relays: health.smtpRelays,
      queues: health.queues,
      campaigns: health.campaigns,
      alertCount: health.alerts.length,
    });

    // Log each alert as a warning
    for (const alert of health.alerts) {
      logger.warn("System health alert", { alert, status: health.status });
    }
  } catch (error) {
    logger.error("Monitor cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const startMonitoring = (): void => {
  if (monitorTimer) return;

  logger.info("Starting system monitoring", {
    intervalMs: MONITOR_INTERVAL_MS,
    dlqThreshold: DLQ_ALERT_THRESHOLD,
    stuckCampaignMinutes: STUCK_CAMPAIGN_ALERT_MINUTES,
  });

  // Run immediately on start
  runMonitorCycle().catch((error) => {
    logger.error("Initial monitor cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  monitorTimer = setInterval(() => {
    runMonitorCycle().catch((error) => {
      logger.error("Monitor cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, MONITOR_INTERVAL_MS);
};

export const stopMonitoring = (): void => {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    logger.info("System monitoring stopped");
  }
};