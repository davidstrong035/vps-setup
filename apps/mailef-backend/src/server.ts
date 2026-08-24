import "./config/env";
import app from "./app";
import connectDB from "./config/db";
import { startMailWorker } from "./queue/mail.worker";
import { startActiveCampaignDispatcher } from "./services/active-campaign-dispatcher.service";
import { startScheduledCampaignDispatcher } from "./services/scheduled-campaign-dispatcher.service";
import { startRelayHealthChecker } from "./services/relay-health-check.service";
import { startMonitoring, buildHealthStatus } from "./services/monitoring.service";
import { logger, logStartup } from "./utils/logger";

const PORT = process.env.PORT || 4400;
const isScheduledDispatchEnabled = /^(1|true|yes|on)$/i.test(
  process.env.ENABLE_SCHEDULED_CAMPAIGN_DISPATCHER || "false"
);
const isActiveDispatchEnabled = /^(1|true|yes|on)$/i.test(
  process.env.ENABLE_ACTIVE_CAMPAIGN_DISPATCHER || "true"
);
const isRelayHealthCheckEnabled = /^(1|true|yes|on)$/i.test(
  process.env.ENABLE_RELAY_HEALTH_CHECK || "true"
);
const isMonitoringEnabled = /^(1|true|yes|on)$/i.test(
  process.env.ENABLE_MONITORING || "true"
);

const start = async () => {
  await connectDB();

  // start the BullMQ worker in the same process (can be split out later)
  startMailWorker();
  logger.info("Mail worker started");

  if (isScheduledDispatchEnabled) {
    startScheduledCampaignDispatcher();
    logger.info("Scheduled campaign dispatcher started");
  } else {
    logger.info("Scheduled campaign dispatcher disabled");
  }

  if (isActiveDispatchEnabled) {
    startActiveCampaignDispatcher();
    logger.info("Active campaign dispatcher started");
  } else {
    logger.info("Active campaign dispatcher disabled");
  }

  if (isRelayHealthCheckEnabled) {
    startRelayHealthChecker();
  } else {
    logger.info("Relay health checker disabled");
  }

  if (isMonitoringEnabled) {
    startMonitoring();
  } else {
    logger.info("System monitoring disabled");
  }

  // Enhanced health endpoint with system status
  app.get("/health", async (_req, res) => {
    try {
      const health = await buildHealthStatus();
      const httpStatus = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
      res.status(httpStatus).json(health);
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.listen(PORT, () => {
    logStartup(PORT);
  });
};

start().catch((err) => {
  logger.error("Failed to start server", { error: err });
  process.exit(1);
});
