"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./config/env");
const app_1 = __importDefault(require("./app"));
const db_1 = __importDefault(require("./config/db"));
const mail_worker_1 = require("./queue/mail.worker");
const active_campaign_dispatcher_service_1 = require("./services/active-campaign-dispatcher.service");
const scheduled_campaign_dispatcher_service_1 = require("./services/scheduled-campaign-dispatcher.service");
const relay_health_check_service_1 = require("./services/relay-health-check.service");
const monitoring_service_1 = require("./services/monitoring.service");
const logger_1 = require("./utils/logger");
const PORT = process.env.PORT || 4400;
const isScheduledDispatchEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_SCHEDULED_CAMPAIGN_DISPATCHER || "false");
const isActiveDispatchEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_ACTIVE_CAMPAIGN_DISPATCHER || "true");
const isRelayHealthCheckEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_RELAY_HEALTH_CHECK || "true");
const isMonitoringEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_MONITORING || "true");
const start = async () => {
    await (0, db_1.default)();
    // start the BullMQ worker in the same process (can be split out later)
    (0, mail_worker_1.startMailWorker)();
    logger_1.logger.info("Mail worker started");
    if (isScheduledDispatchEnabled) {
        (0, scheduled_campaign_dispatcher_service_1.startScheduledCampaignDispatcher)();
        logger_1.logger.info("Scheduled campaign dispatcher started");
    }
    else {
        logger_1.logger.info("Scheduled campaign dispatcher disabled");
    }
    if (isActiveDispatchEnabled) {
        (0, active_campaign_dispatcher_service_1.startActiveCampaignDispatcher)();
        logger_1.logger.info("Active campaign dispatcher started");
    }
    else {
        logger_1.logger.info("Active campaign dispatcher disabled");
    }
    if (isRelayHealthCheckEnabled) {
        (0, relay_health_check_service_1.startRelayHealthChecker)();
    }
    else {
        logger_1.logger.info("Relay health checker disabled");
    }
    if (isMonitoringEnabled) {
        (0, monitoring_service_1.startMonitoring)();
    }
    else {
        logger_1.logger.info("System monitoring disabled");
    }
    // Enhanced health endpoint with system status
    app_1.default.get("/health", async (_req, res) => {
        try {
            const health = await (0, monitoring_service_1.buildHealthStatus)();
            const httpStatus = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
            res.status(httpStatus).json(health);
        }
        catch (error) {
            res.status(503).json({
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    app_1.default.listen(PORT, () => {
        (0, logger_1.logStartup)(PORT);
    });
};
start().catch((err) => {
    logger_1.logger.error("Failed to start server", { error: err });
    process.exit(1);
});
//# sourceMappingURL=server.js.map