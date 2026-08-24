"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePlatformDispatchSettings = exports.getPlatformDispatchSettings = exports.updatePlatformMailSettings = exports.getPlatformMailSettings = exports.clearPlatformMailSettingsCache = exports.toAdminMailSettings = void 0;
const PlatformSettings_model_1 = __importDefault(require("../models/PlatformSettings.model"));
const DEFAULT_SINGLETON_KEY = "platform";
const CACHE_TTL_MS = 60000;
let cachedMailSettings = null;
let cachedDispatchSettings = null;
let cacheExpiresAt = 0;
const isTruthy = (value) => /^(1|true|yes|on)$/i.test(value || "");
const fallbackMailSettings = () => {
    const requestedPort = Number(process.env.SMTP_PORT || "");
    const smtpSecure = isTruthy(process.env.SMTP_SECURE) || requestedPort === 465;
    return {
        provider: process.env.MAIL_PROVIDER?.trim().toLowerCase() === "smtp"
            ? "smtp"
            : "ses",
        defaultFromName: process.env.DEFAULT_FROM_NAME?.trim() || "Maileff Team",
        verifiedFromEmail: process.env.MAIL_FROM_EMAIL?.trim() ||
            process.env.SMTP_FROM_EMAIL?.trim() ||
            process.env.SES_FROM_EMAIL?.trim() ||
            "",
        configurationSetName: process.env.SES_CONFIGURATION_SET?.trim() || "",
        smtpHost: process.env.SMTP_HOST?.trim() || "",
        smtpPort: Number.isFinite(requestedPort) && requestedPort > 0
            ? requestedPort
            : smtpSecure
                ? 465
                : 587,
        smtpUsername: process.env.SMTP_USER?.trim() || "",
        smtpPassword: process.env.SMTP_PASSWORD || "",
        smtpSecure,
        smtpTlsRejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
    };
};
const fallbackDispatchSettings = () => ({
    enabled: /^(1|true|yes|on)$/i.test(process.env.ENABLE_ACTIVE_CAMPAIGN_DISPATCHER || "true"),
    intervalMs: Math.max(Number(process.env.ACTIVE_DISPATCH_INTERVAL_MS) || 5000, 2000),
    usersPerTick: Math.max(Number(process.env.ACTIVE_DISPATCH_USERS_PER_TICK) || 20, 1),
    maxPerRun: Math.max(Number(process.env.CAMPAIGN_DISPATCH_MAX_PER_RUN) || 500, 100),
    workerConcurrency: Math.max(Number(process.env.MAIL_WORKER_CONCURRENCY) || 5, 1),
    workerRateLimitMax: Math.max(Number(process.env.MAIL_RATE_LIMIT_MAX) || 20, 1),
    workerRateLimitDurationMs: Math.max(Number(process.env.MAIL_RATE_LIMIT_DURATION_MS) || 60000, 100),
    customIntervalMinutes: Number(process.env.CUSTOM_INTERVAL_MINUTES) || undefined,
});
const normalize = (input) => {
    const fallback = fallbackMailSettings();
    return {
        provider: input?.mailProvider === "smtp"
            ? "smtp"
            : input?.mailProvider === "ses"
                ? "ses"
                : fallback.provider,
        defaultFromName: input?.mailDefaultFromName?.trim() || fallback.defaultFromName,
        verifiedFromEmail: input?.mailVerifiedFromEmail?.trim().toLowerCase() || fallback.verifiedFromEmail,
        configurationSetName: input?.mailConfigurationSetName?.trim() || fallback.configurationSetName,
        smtpHost: input?.smtpHost?.trim() || fallback.smtpHost,
        smtpPort: Math.max(Number(input?.smtpPort ?? fallback.smtpPort) || fallback.smtpPort, 1),
        smtpUsername: input?.smtpUsername?.trim() || fallback.smtpUsername,
        smtpPassword: input?.smtpPassword || fallback.smtpPassword,
        smtpSecure: typeof input?.smtpSecure === "boolean" ? input.smtpSecure : fallback.smtpSecure,
        smtpTlsRejectUnauthorized: typeof input?.smtpTlsRejectUnauthorized === "boolean"
            ? input.smtpTlsRejectUnauthorized
            : fallback.smtpTlsRejectUnauthorized,
    };
};
const normalizeDispatchSettings = (input) => {
    const fallback = fallbackDispatchSettings();
    return {
        enabled: typeof input?.dispatchEnabled === "boolean" ? input.dispatchEnabled : fallback.enabled,
        intervalMs: Math.max(input?.dispatchIntervalMs ?? fallback.intervalMs, 2000),
        usersPerTick: Math.max(input?.dispatchUsersPerTick ?? fallback.usersPerTick, 1),
        maxPerRun: Math.max(input?.dispatchMaxPerRun ?? fallback.maxPerRun, 100),
        workerConcurrency: Math.max(input?.workerConcurrency ?? fallback.workerConcurrency, 1),
        workerRateLimitMax: Math.max(input?.workerRateLimitMax ?? fallback.workerRateLimitMax, 1),
        workerRateLimitDurationMs: Math.max(input?.workerRateLimitDurationMs ?? fallback.workerRateLimitDurationMs, 100),
        customIntervalMinutes: input?.customIntervalMinutes ?? fallback.customIntervalMinutes,
    };
};
const toAdminMailSettings = (mailSettings) => ({
    provider: mailSettings.provider,
    defaultFromName: mailSettings.defaultFromName,
    verifiedFromEmail: mailSettings.verifiedFromEmail,
    configurationSetName: mailSettings.configurationSetName,
    smtpHost: mailSettings.smtpHost,
    smtpPort: mailSettings.smtpPort,
    smtpUsername: mailSettings.smtpUsername,
    smtpSecure: mailSettings.smtpSecure,
    smtpTlsRejectUnauthorized: mailSettings.smtpTlsRejectUnauthorized,
    smtpPasswordConfigured: Boolean(mailSettings.smtpPassword),
});
exports.toAdminMailSettings = toAdminMailSettings;
const clearPlatformMailSettingsCache = () => {
    cachedMailSettings = null;
    cachedDispatchSettings = null;
    cacheExpiresAt = 0;
};
exports.clearPlatformMailSettingsCache = clearPlatformMailSettingsCache;
const getPlatformMailSettings = async () => {
    if (cachedMailSettings && cacheExpiresAt > Date.now()) {
        return cachedMailSettings;
    }
    const settings = await PlatformSettings_model_1.default.findOne({ singletonKey: DEFAULT_SINGLETON_KEY }).lean();
    const normalized = normalize(settings);
    cachedMailSettings = normalized;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return normalized;
};
exports.getPlatformMailSettings = getPlatformMailSettings;
const updatePlatformMailSettings = async (input) => {
    const existing = await PlatformSettings_model_1.default.findOne({ singletonKey: DEFAULT_SINGLETON_KEY }).lean();
    const update = {
        singletonKey: DEFAULT_SINGLETON_KEY,
        mailProvider: input.provider === "smtp"
            ? "smtp"
            : input.provider === "ses"
                ? "ses"
                : existing?.mailProvider,
        mailDefaultFromName: input.defaultFromName !== undefined
            ? input.defaultFromName.trim() || undefined
            : existing?.mailDefaultFromName,
        mailVerifiedFromEmail: input.verifiedFromEmail !== undefined
            ? input.verifiedFromEmail.trim().toLowerCase() || undefined
            : existing?.mailVerifiedFromEmail,
        mailConfigurationSetName: input.configurationSetName !== undefined
            ? input.configurationSetName.trim() || undefined
            : existing?.mailConfigurationSetName,
        smtpHost: input.smtpHost !== undefined ? input.smtpHost.trim() || undefined : existing?.smtpHost,
        smtpPort: input.smtpPort !== undefined
            ? Math.max(Math.floor(Number(input.smtpPort) || 0), 1) || undefined
            : existing?.smtpPort,
        smtpUsername: input.smtpUsername !== undefined
            ? input.smtpUsername.trim() || undefined
            : existing?.smtpUsername,
        smtpPassword: input.smtpPassword !== undefined
            ? input.smtpPassword.trim() || existing?.smtpPassword || undefined
            : existing?.smtpPassword,
        smtpSecure: typeof input.smtpSecure === "boolean" ? input.smtpSecure : existing?.smtpSecure,
        smtpTlsRejectUnauthorized: typeof input.smtpTlsRejectUnauthorized === "boolean"
            ? input.smtpTlsRejectUnauthorized
            : existing?.smtpTlsRejectUnauthorized,
    };
    await PlatformSettings_model_1.default.findOneAndUpdate({ singletonKey: DEFAULT_SINGLETON_KEY }, { $set: update }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
    (0, exports.clearPlatformMailSettingsCache)();
    return (0, exports.getPlatformMailSettings)();
};
exports.updatePlatformMailSettings = updatePlatformMailSettings;
const getPlatformDispatchSettings = async () => {
    if (cachedDispatchSettings && cacheExpiresAt > Date.now()) {
        return cachedDispatchSettings;
    }
    const settings = await PlatformSettings_model_1.default.findOne({ singletonKey: DEFAULT_SINGLETON_KEY }).lean();
    const normalized = normalizeDispatchSettings(settings);
    cachedDispatchSettings = normalized;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return normalized;
};
exports.getPlatformDispatchSettings = getPlatformDispatchSettings;
const updatePlatformDispatchSettings = async (input) => {
    const update = {
        dispatchEnabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
        dispatchIntervalMs: input.intervalMs !== undefined ? Math.max(Math.floor(input.intervalMs), 2000) : undefined,
        dispatchUsersPerTick: input.usersPerTick !== undefined ? Math.max(Math.floor(input.usersPerTick), 1) : undefined,
        dispatchMaxPerRun: input.maxPerRun !== undefined ? Math.max(Math.floor(input.maxPerRun), 100) : undefined,
        workerConcurrency: input.workerConcurrency !== undefined
            ? Math.max(Math.floor(input.workerConcurrency), 1)
            : undefined,
        workerRateLimitMax: input.workerRateLimitMax !== undefined
            ? Math.max(Math.floor(input.workerRateLimitMax), 1)
            : undefined,
        workerRateLimitDurationMs: input.workerRateLimitDurationMs !== undefined
            ? Math.max(Math.floor(input.workerRateLimitDurationMs), 100)
            : undefined,
    };
    await PlatformSettings_model_1.default.findOneAndUpdate({ singletonKey: DEFAULT_SINGLETON_KEY }, { $set: { singletonKey: DEFAULT_SINGLETON_KEY, ...update } }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
    (0, exports.clearPlatformMailSettingsCache)();
    return (0, exports.getPlatformDispatchSettings)();
};
exports.updatePlatformDispatchSettings = updatePlatformDispatchSettings;
//# sourceMappingURL=platform-settings.service.js.map