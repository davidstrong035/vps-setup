module.exports = {
  apps: [
    {
      name: "mailer-backend",
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
        MONGODB_URI_PROD: process.env.MONGODB_URI_PROD,
        REDIS_URL: process.env.REDIS_URL,
        REDIS_HOST: process.env.REDIS_HOST,
        REDIS_PORT: process.env.REDIS_PORT,
        REDIS_PASSWORD: process.env.REDIS_PASSWORD,
      },
    },
    {
      name: "daily-reset",
      script: "dist/scripts/daily-reset.js",
      cron_restart: "0 0 * * *",
      autorestart: false,
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
        MONGODB_URI_PROD: process.env.MONGODB_URI_PROD,
      },
    },
    {
      name: "cleanup-old-recipients",
      script: "dist/scripts/cleanup-old-recipients.js",
      // Run every hour as a safety net. The automatic cleanup on campaign
      // completion handles the normal case; this catches any that were missed.
      cron_restart: "0 * * * *",
      autorestart: false,
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
        MONGODB_URI_PROD: process.env.MONGODB_URI_PROD,
        DELETE_RECIPIENTS_ON_COMPLETE: process.env.DELETE_RECIPIENTS_ON_COMPLETE,
        CAMPAIGN_RECIPIENT_CLEANUP_AGE_HOURS: process.env.CAMPAIGN_RECIPIENT_CLEANUP_AGE_HOURS,
      },
    },
  ],
};
