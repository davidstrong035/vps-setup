"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopRelayHealthChecker = exports.startRelayHealthChecker = exports.recordRelaySendSuccess = exports.recordRelaySendFailure = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const SmtpRelay_model_1 = __importDefault(require("../models/SmtpRelay.model"));
const logger_1 = require("../utils/logger");
// Config
const HEALTH_CHECK_INTERVAL_MS = Math.max(Number(process.env.RELAY_HEALTH_CHECK_INTERVAL_MS) || 60000, 10000);
const HEALTH_CHECK_TIMEOUT_MS = Math.max(Number(process.env.RELAY_HEALTH_CHECK_TIMEOUT_MS) || 10000, 2000);
const MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN = Math.max(Number(process.env.RELAY_MAX_FAILURES_BEFORE_DOWN) || 3, 1);
const MAX_CONSECUTIVE_FAILURES_BEFORE_DEGRADED = Math.max(Number(process.env.RELAY_MAX_FAILURES_BEFORE_DEGRADED) || 1, 1);
const CONSECUTIVE_SUCCESSES_TO_RECOVER = Math.max(Number(process.env.RELAY_SUCCESSES_TO_RECOVER) || 2, 1);
let healthCheckTimer = null;
const buildTransporterForRelay = (relay) => {
    const secure = relay.secure || relay.port === 465;
    return nodemailer_1.default.createTransport({
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
const checkRelay = async (relay) => {
    try {
        const transport = buildTransporterForRelay(relay);
        await transport.verify();
        transport.close();
        return true;
    }
    catch (error) {
        return false;
    }
};
/**
 * Updates a relay's health status based on the result of a health check.
 * Auto-deactivates if consecutive failures exceed the threshold.
 */
const applyHealthResult = async (relayId, isHealthy, relayName, relayHost) => {
    const relay = await SmtpRelay_model_1.default.findById(relayId);
    if (!relay)
        return;
    if (isHealthy) {
        // Reset consecutive failures on success
        const newConsecutive = 0;
        let newStatus = "healthy";
        // If it was previously down/degraded, it needs CONSECUTIVE_SUCCESSES_TO_RECOVER successes
        // before being marked healthy again. Use a separate counter for the recovery check.
        if (relay.healthStatus === "down" || relay.healthStatus === "degraded") {
            // Track recovery attempts in a transient way: we increment recovery progress
            // stored temporarily (we use consecutiveFailures as a recovery counter when healing)
            const recoveryProgress = Math.max(relay.consecutiveFailures, 0) + 1;
            if (recoveryProgress >= CONSECUTIVE_SUCCESSES_TO_RECOVER) {
                newStatus = "healthy";
                logger_1.logger.info("Relay recovered and marked healthy", {
                    relayId,
                    relayName,
                    host: relayHost,
                    previousStatus: relay.healthStatus,
                });
            }
            else {
                newStatus = "degraded";
            }
            relay.consecutiveFailures = recoveryProgress;
        }
        else {
            relay.consecutiveFailures = 0;
        }
        relay.healthStatus = newStatus;
        relay.lastHealthCheckAt = new Date();
        // If it was previously auto-deactivated and now healthy, reactivate it
        if (!relay.isActive && relay.healthStatus === "healthy") {
            relay.isActive = true;
            logger_1.logger.info("Relay auto-reactivated after recovering health", {
                relayId,
                relayName,
                host: relayHost,
            });
        }
        await relay.save();
    }
    else {
        // Failed health check
        const newConsecutive = (relay.consecutiveFailures || 0) + 1;
        let newStatus = "degraded";
        if (newConsecutive >= MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN) {
            newStatus = "down";
        }
        relay.healthStatus = newStatus;
        relay.consecutiveFailures = newConsecutive;
        relay.lastHealthCheckAt = new Date();
        // Auto-deactivate if down
        if (newStatus === "down" && relay.isActive) {
            relay.isActive = false;
            logger_1.logger.warn("Relay auto-deactivated due to health check failures", {
                relayId,
                relayName,
                host: relayHost,
                consecutiveFailures: newConsecutive,
                threshold: MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN,
            });
        }
        await relay.save();
    }
};
/**
 * Marks a relay failure from a live send attempt (not a health check probe).
 * This is called by the mailer when sending through a relay fails.
 */
const recordRelaySendFailure = async (relayId) => {
    try {
        const relay = await SmtpRelay_model_1.default.findById(relayId);
        if (!relay)
            return;
        const newConsecutive = (relay.consecutiveFailures || 0) + 1;
        let newStatus = "degraded";
        if (newConsecutive >= MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN) {
            newStatus = "down";
        }
        // Only auto-deactivate on send failure if it's a hard failure
        if (newStatus === "down" && relay.isActive) {
            relay.isActive = false;
            logger_1.logger.warn("Relay auto-deactivated due to send failure", {
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
    }
    catch (error) {
        logger_1.logger.error("Failed to record relay send failure", { relayId, error });
    }
};
exports.recordRelaySendFailure = recordRelaySendFailure;
/**
 * Marks a relay send success. Resets consecutive failures.
 */
const recordRelaySendSuccess = async (relayId) => {
    try {
        await SmtpRelay_model_1.default.findByIdAndUpdate(relayId, {
            $set: {
                consecutiveFailures: 0,
                healthStatus: "healthy",
                lastHealthCheckAt: new Date(),
            },
        });
    }
    catch (error) {
        logger_1.logger.error("Failed to record relay send success", { relayId, error });
    }
};
exports.recordRelaySendSuccess = recordRelaySendSuccess;
/**
 * Runs one full health check cycle: checks all non-archived relays,
 * updates statuses, auto-deactivates down relays.
 */
const runHealthCheckCycle = async () => {
    try {
        // Check all non-archived relays (including inactive ones that might have recovered)
        const relays = await SmtpRelay_model_1.default.find({ isArchived: { $ne: true } }).lean();
        if (relays.length === 0)
            return;
        for (const relay of relays) {
            const runtimeRelay = {
                id: relay._id.toString(),
                name: relay.name,
                host: relay.host,
                port: relay.port,
                username: relay.username || "",
                password: relay.password || "",
                secure: relay.secure || false,
                tlsRejectUnauthorized: relay.tlsRejectUnauthorized !== false,
                isActive: relay.isActive,
                isArchived: relay.isArchived,
                weight: relay.weight,
                sentToday: relay.sentToday,
                usageDate: relay.usageDate || "",
                lastUsedAt: relay.lastUsedAt || null,
                notes: relay.notes || "",
                healthStatus: (relay.healthStatus || "unknown"),
                consecutiveFailures: relay.consecutiveFailures || 0,
                lastHealthCheckAt: relay.lastHealthCheckAt || null,
            };
            const isHealthy = await checkRelay(runtimeRelay);
            await applyHealthResult(runtimeRelay.id, isHealthy, runtimeRelay.name, runtimeRelay.host);
        }
    }
    catch (error) {
        logger_1.logger.error("Relay health check cycle failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
const startRelayHealthChecker = () => {
    if (healthCheckTimer)
        return;
    logger_1.logger.info("Starting relay health checker", {
        intervalMs: HEALTH_CHECK_INTERVAL_MS,
        maxFailuresBeforeDown: MAX_CONSECUTIVE_FAILURES_BEFORE_DOWN,
    });
    // Run immediately on start
    runHealthCheckCycle().catch((error) => {
        logger_1.logger.error("Initial relay health check failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    healthCheckTimer = setInterval(() => {
        runHealthCheckCycle().catch((error) => {
            logger_1.logger.error("Relay health check cycle failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }, HEALTH_CHECK_INTERVAL_MS);
};
exports.startRelayHealthChecker = startRelayHealthChecker;
const stopRelayHealthChecker = () => {
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer);
        healthCheckTimer = null;
        logger_1.logger.info("Relay health checker stopped");
    }
};
exports.stopRelayHealthChecker = stopRelayHealthChecker;
//# sourceMappingURL=relay-health-check.service.js.map