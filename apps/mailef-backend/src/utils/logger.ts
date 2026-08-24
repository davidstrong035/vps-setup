import "../config/env";
import winston from "winston";
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";

const isDev = process.env.NODE_ENV !== "production";
const logtailToken = process.env.BETTERSTACK_TOKEN;
const logLevel =
  process.env.LOG_LEVEL?.trim().toLowerCase() || (isDev ? "debug" : "http");
const dbName = isDev ? "development" : "production";
const redisHost = process.env.REDIS_URL
  ? new URL(process.env.REDIS_URL).hostname
  : process.env.REDIS_HOST || "localhost";

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] ${level}: ${message}${extras}`;
  })
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isDev ? consoleFormat : jsonFormat,
  }),
];

if (logtailToken) {
  const logtail = new Logtail(logtailToken);
  transports.push(new LogtailTransport(logtail));
}

export const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: {
    service: "maileff-backend",
    env: process.env.NODE_ENV || "development",
  },
  transports,
});

// Log startup summary (no secrets)
export const logStartup = (port: number | string) => {
  logger.info("=== Maileff backend starting ===", {
    env: process.env.NODE_ENV || "development",
    port,
    database: dbName,
    redisHost,
    betterstack: logtailToken ? "connected" : "disabled (no token)",
    logLevel,
  });
};
