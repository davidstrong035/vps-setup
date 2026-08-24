"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopMonitoring = exports.startMonitoring = exports.buildHealthStatus = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const mail_dead_letter_queue_1 = require("../queue/mail.dead-letter.queue");
const Campaign_model_1 = __importDefault(require("../models/Campaign.model"));
const SmtpRelay_model_1 = __importDefault(require("../models/SmtpRelay.model"));
const global_quota_usage_service_1 = require("./global-quota-usage.service");
const logger_1 = require("../utils/logger");
// Config
const MONITOR_INTERVAL_MS = Math.max(Number(process.env.MONITOR_INTERVAL_MS) || 120000, 10000);
const DLQ_ALERT_THRESHOLD = Math.max(Number(process.env.MONITOR_DLQ_ALERT_THRESHOLD) || 50, 1);
const STUCK_CAMPAIGN_ALERT_MINUTES = Math.max(Number(process.env.MONITOR_STUCK_CAMPAIGN_MINUTES) || 30, 5);
const HIGH_BOUNCE_RATE_THRESHOLD = Math.max(Number(process.env.MONITOR_BOUNCE_THRESHOLD_PERCENT) || 5, 1);
let monitorTimer = null;
const isRedisConnected = () => {
    try {
        const { getRedisClient } = require("../config/redis-client");
        const redis = getRedisClient();
        return redis.status === "ready";
    }
    catch {
        return false;
    }
};
const buildHealthStatus = async () => {
    const alerts = [];
    // Database
    const dbConnected = mongoose_1.default.connection.readyState === 1;
    // Redis
    const redisConnected = isRedisConnected();
    // SMTP Relays
    const relays = await SmtpRelay_model_1.default.find({ isArchived: { $ne: true } }).lean();
    const healthyRelays = relays.filter((r) => r.healthStatus === "healthy");
    const degradedRelays = relays.filter((r) => r.healthStatus === "degraded");
    const downRelays = relays.filter((r) => r.healthStatus === "down");
    const autoDeactivated = relays.filter((r) => !r.isActive && r.consecutiveFailures > 0);
    if (downRelays.length > 0) {
        alerts.push(`${downRelays.length} SMTP relay(s) are DOWN and auto-deactivated. Check logs.`);
    }
    if (degradedRelays.length > 0) {
        alerts.push(`${degradedRelays.length} SMTP relay(s) are in degraded state.`);
    }
    // Queues
    const pendingJobs = await mail_dead_letter_queue_1.mailDeadLetterQueue.getWaitingCount().catch(() => 0);
    // For DLQ size, we count completed+failed as approximations
    const dlqMeta = await mail_dead_letter_queue_1.mailDeadLetterQueue.getJobCounts().catch(() => ({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
    }));
    const deadLetterCount = dlqMeta.waiting + dlqMeta.active + dlqMeta.delayed;
    if (deadLetterCount > DLQ_ALERT_THRESHOLD) {
        alerts.push(`Dead Letter Queue has ${deadLetterCount} items (threshold: ${DLQ_ALERT_THRESHOLD}). Review failed emails.`);
    }
    // Campaigns stuck in "sending" state
    const stuckThreshold = new Date(Date.now() - STUCK_CAMPAIGN_ALERT_MINUTES * 60 * 1000);
    const stuckCampaigns = await Campaign_model_1.default.countDocuments({
        status: "sending",
        updatedAt: { $lt: stuckThreshold },
    }).catch(() => 0);
    if (stuckCampaigns > 0) {
        alerts.push(`${stuckCampaigns} campaign(s) stuck in "sending" for over ${STUCK_CAMPAIGN_ALERT_MINUTES} minutes. Check dispatcher health.`);
    }
    const sendingCampaigns = await Campaign_model_1.default.countDocuments({ status: "sending" }).catch(() => 0);
    const pausedCampaigns = await Campaign_model_1.default.countDocuments({ status: "paused" }).catch(() => 0);
    const totalCampaigns = await Campaign_model_1.default.countDocuments({}).catch(() => 0);
    // Bounce rate check
    const recentCampaigns = await Campaign_model_1.default.find({
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
            alerts.push(`High bounce rate in the last 24 hours: ${bounceRate.toFixed(1)}% (threshold: ${HIGH_BOUNCE_RATE_THRESHOLD}%). Check sending domain health.`);
        }
    }
    // Global quota usage
    let globalQuota = null;
    try {
        const usage = await (0, global_quota_usage_service_1.getGlobalQuotaUsage)();
        globalQuota = {
            perMinute: usage.perMinute.limit !== undefined
                ? { used: usage.perMinute.used, limit: usage.perMinute.limit }
                : null,
            perHour: usage.perHour.limit !== undefined
                ? { used: usage.perHour.used, limit: usage.perHour.limit }
                : null,
            perDay: usage.perDay.limit !== undefined
                ? { used: usage.perDay.used, limit: usage.perDay.limit }
                : null,
        };
        if (usage.perDay.limit !== undefined && usage.perDay.remaining === 0) {
            alerts.push("Global daily send limit has been reached. No sends until the day resets.");
        }
    }
    catch {
        globalQuota = null;
    }
    // Determine overall status
    let status = "healthy";
    if (!dbConnected || !redisConnected || deadLetterCount > DLQ_ALERT_THRESHOLD * 3) {
        status = "unhealthy";
    }
    else if (downRelays.length > 0 ||
        degradedRelays.length > 0 ||
        stuckCampaigns > 0 ||
        deadLetterCount > DLQ_ALERT_THRESHOLD) {
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
exports.buildHealthStatus = buildHealthStatus;
const runMonitorCycle = async () => {
    try {
        const health = await buildHealthStatus();
        logger_1.logger.info("System health monitor cycle", {
            status: health.status,
            relays: health.smtpRelays,
            queues: health.queues,
            campaigns: health.campaigns,
            alertCount: health.alerts.length,
        });
        // Log each alert as a warning
        for (const alert of health.alerts) {
            logger_1.logger.warn("System health alert", { alert, status: health.status });
        }
    }
    catch (error) {
        logger_1.logger.error("Monitor cycle failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
const startMonitoring = () => {
    if (monitorTimer)
        return;
    logger_1.logger.info("Starting system monitoring", {
        intervalMs: MONITOR_INTERVAL_MS,
        dlqThreshold: DLQ_ALERT_THRESHOLD,
        stuckCampaignMinutes: STUCK_CAMPAIGN_ALERT_MINUTES,
    });
    // Run immediately on start
    runMonitorCycle().catch((error) => {
        logger_1.logger.error("Initial monitor cycle failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    monitorTimer = setInterval(() => {
        runMonitorCycle().catch((error) => {
            logger_1.logger.error("Monitor cycle failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }, MONITOR_INTERVAL_MS);
};
exports.startMonitoring = startMonitoring;
const stopMonitoring = () => {
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
        logger_1.logger.info("System monitoring stopped");
    }
};
exports.stopMonitoring = stopMonitoring;
//# sourceMappingURL=monitoring.service.js.map