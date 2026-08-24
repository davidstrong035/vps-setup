"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logStartup = exports.logger = void 0;
require("../config/env");
const winston_1 = __importDefault(require("winston"));
const node_1 = require("@logtail/node");
const winston_2 = require("@logtail/winston");
const isDev = process.env.NODE_ENV !== "production";
const logtailToken = process.env.BETTERSTACK_TOKEN;
const logLevel = process.env.LOG_LEVEL?.trim().toLowerCase() || (isDev ? "debug" : "http");
const dbName = isDev ? "development" : "production";
const redisHost = process.env.REDIS_URL
    ? new URL(process.env.REDIS_URL).hostname
    : process.env.REDIS_HOST || "localhost";
const consoleFormat = winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.timestamp({ format: "HH:mm:ss" }), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
    const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] ${level}: ${message}${extras}`;
}));
const jsonFormat = winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json());
const transports = [
    new winston_1.default.transports.Console({
        format: isDev ? consoleFormat : jsonFormat,
    }),
];
if (logtailToken) {
    const logtail = new node_1.Logtail(logtailToken);
    transports.push(new winston_2.LogtailTransport(logtail));
}
exports.logger = winston_1.default.createLogger({
    level: logLevel,
    defaultMeta: {
        service: "maileff-backend",
        env: process.env.NODE_ENV || "development",
    },
    transports,
});
// Log startup summary (no secrets)
const logStartup = (port) => {
    exports.logger.info("=== Maileff backend starting ===", {
        env: process.env.NODE_ENV || "development",
        port,
        database: dbName,
        redisHost,
        betterstack: logtailToken ? "connected" : "disabled (no token)",
        logLevel,
    });
};
exports.logStartup = logStartup;
//# sourceMappingURL=logger.js.map