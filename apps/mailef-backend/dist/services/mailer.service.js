"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = exports.verifyMailProvider = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const client_ses_1 = require("@aws-sdk/client-ses");
const ses_1 = require("../config/ses");
const platform_settings_service_1 = require("./platform-settings.service");
const smtp_relay_service_1 = require("./smtp-relay.service");
const relay_health_check_service_1 = require("./relay-health-check.service");
const sending_domain_service_1 = require("./sending-domain.service");
const logger_1 = require("../utils/logger");
const smtpTransportCache = new Map();
const smtpConnectionTimeoutMs = Math.max(Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 15000, 1000);
const smtpGreetingTimeoutMs = Math.max(Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 15000, 1000);
const smtpSocketTimeoutMs = Math.max(Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 60000, 5000);
const filterMailSettingOverrides = (overrides = {}) => Object.fromEntries(Object.entries(overrides).filter(([, value]) => {
    if (value === undefined || value === null)
        return false;
    if (typeof value === "string" && value.trim() === "")
        return false;
    return true;
}));
const hasExplicitSmtpOverride = (overrides = {}) => {
    const smtpFields = [
        "smtpHost",
        "smtpPort",
        "smtpUsername",
        "smtpPassword",
        "smtpSecure",
        "smtpTlsRejectUnauthorized",
    ];
    return smtpFields.some((field) => Object.prototype.hasOwnProperty.call(overrides, field));
};
const resolveMailSettings = async (overrides = {}) => {
    const current = await (0, platform_settings_service_1.getPlatformMailSettings)();
    const filteredOverrides = filterMailSettingOverrides(overrides);
    return {
        ...current,
        ...filteredOverrides,
    };
};
const getSmtpTransport = (mailSettings) => {
    const host = mailSettings.smtpHost?.trim();
    const requestedPort = Number(mailSettings.smtpPort || "");
    const secure = Boolean(mailSettings.smtpSecure) || requestedPort === 465;
    const port = Number.isFinite(requestedPort) && requestedPort > 0
        ? requestedPort
        : secure
            ? 465
            : 587;
    const user = mailSettings.smtpUsername?.trim();
    const pass = mailSettings.smtpPassword;
    if (!host) {
        throw new Error("SMTP provider selected but no SMTP host is configured in Platform Mail Settings.");
    }
    if (user && !pass) {
        throw new Error("SMTP provider selected but no SMTP password is configured in Platform Mail Settings.");
    }
    const transportKey = `${host}:${port}:${secure}:${user || ""}:${pass ? "set" : "empty"}:${mailSettings.smtpTlsRejectUnauthorized}`;
    const cached = smtpTransportCache.get(transportKey);
    if (cached) {
        return cached;
    }
    const transport = nodemailer_1.default.createTransport({
        host,
        port,
        secure,
        connectionTimeout: smtpConnectionTimeoutMs,
        greetingTimeout: smtpGreetingTimeoutMs,
        socketTimeout: smtpSocketTimeoutMs,
        ...(user ? { auth: { user, pass: pass || "" } } : {}),
        ...(mailSettings.smtpTlsRejectUnauthorized === false
            ? { tls: { rejectUnauthorized: false } }
            : {}),
    });
    smtpTransportCache.set(transportKey, transport);
    return transport;
};
const buildMailSettingsFromRelay = (mailSettings, relay) => ({
    ...mailSettings,
    smtpHost: relay.host,
    smtpPort: relay.port,
    smtpUsername: relay.username,
    smtpPassword: relay.password,
    smtpSecure: relay.secure,
    smtpTlsRejectUnauthorized: relay.tlsRejectUnauthorized,
});
const sendViaSes = async (options, source, mailSettings, replyToAddresses) => {
    const message = {
        Subject: {
            Data: options.subject,
            Charset: "UTF-8",
        },
        Body: {
            Html: {
                Data: options.html,
                Charset: "UTF-8",
            },
        },
    };
    const configurationSetName = mailSettings.configurationSetName || process.env.SES_CONFIGURATION_SET?.trim();
    try {
        const result = await ses_1.sesClient.send(new client_ses_1.SendEmailCommand({
            Source: source,
            Destination: { ToAddresses: [options.to] },
            ...(replyToAddresses ? { ReplyToAddresses: replyToAddresses } : {}),
            Message: message,
            ...(configurationSetName
                ? { ConfigurationSetName: configurationSetName }
                : {}),
        }));
        return result.MessageId ?? "";
    }
    catch (error) {
        const err = error;
        const missingConfigSet = err?.name === "ConfigurationSetDoesNotExistException" ||
            (((err?.message ?? "").includes("Configuration set")) &&
                (err?.message ?? "").includes("does not exist"));
        if (configurationSetName && missingConfigSet) {
            logger_1.logger.warn("SES configuration set not found, retrying send without configuration set", {
                configurationSetName,
                to: options.to,
            });
            const result = await ses_1.sesClient.send(new client_ses_1.SendEmailCommand({
                Source: source,
                Destination: { ToAddresses: [options.to] },
                ...(replyToAddresses ? { ReplyToAddresses: replyToAddresses } : {}),
                Message: message,
            }));
            return result.MessageId ?? "";
        }
        throw error;
    }
};
const sendViaSmtpWithSettings = async (options, source, mailSettings, replyToAddresses, senderDomain) => {
    const transport = getSmtpTransport(mailSettings);
    const sourceEmail = source.includes('<')
        ? source.match(/<(.+)>/)?.[1] || source
        : source;
    const senderAddress = senderDomain ? `no-reply@${senderDomain}` : sourceEmail;
    const result = await transport.sendMail({
        from: source,
        sender: senderAddress,
        to: options.to,
        ...(replyToAddresses ? { replyTo: replyToAddresses } : {}),
        subject: options.subject,
        html: options.html,
    });
    return result.messageId || "";
};
const extractDomainFromEmail = (email) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail.includes("@"))
        return "";
    return normalizedEmail.split("@")[1] || "";
};
const sendViaSmtp = async (options, source, mailSettings, replyToAddresses, overrides = {}) => {
    if (!hasExplicitSmtpOverride(overrides)) {
        // Always derive relay mapping from the effective SMTP source address.
        // This prevents stale campaign fromEmail values from forcing wrong relay mapping.
        const sourceDomain = extractDomainFromEmail(source);
        const requestedDomain = extractDomainFromEmail(options.fromEmail);
        const sendingDomain = sourceDomain || requestedDomain;
        const mappedRelayIds = await (0, sending_domain_service_1.getMappedSmtpRelayIdsForDomain)(sendingDomain);
        const activeRelays = await (0, smtp_relay_service_1.getActiveSmtpRelays)(options.userId);
        let relays = activeRelays.filter((relay) => {
            if (!mappedRelayIds || mappedRelayIds.length === 0)
                return true;
            return mappedRelayIds.includes(relay.id);
        });
        if (mappedRelayIds && mappedRelayIds.length > 0 && relays.length === 0) {
            // Mapping can become stale when relays are disabled/replaced. Fall back to active
            // relays instead of blocking all sends for the domain.
            logger_1.logger.warn("No active relay matched domain mapping, falling back to all active relays", {
                sendingDomain,
                mappedRelayIds,
                activeRelayIds: activeRelays.map((relay) => relay.id),
            });
            relays = activeRelays;
        }
        if (relays.length > 0) {
            const attemptRelaySet = async (candidateRelays) => {
                let lastError = null;
                for (const relay of candidateRelays) {
                    try {
                        const relaySettings = buildMailSettingsFromRelay(mailSettings, relay);
                        const senderDomain = await (0, sending_domain_service_1.getVerifiedDomainForRelay)(relay.id, options.userId);
                        const messageId = await sendViaSmtpWithSettings(options, source, relaySettings, replyToAddresses, senderDomain);
                        await (0, smtp_relay_service_1.markSmtpRelayUsed)(relay.id);
                        // Record send success for health tracking
                        await (0, relay_health_check_service_1.recordRelaySendSuccess)(relay.id);
                        return messageId;
                    }
                    catch (error) {
                        lastError = error;
                        logger_1.logger.warn("SMTP relay failed, trying the next active relay", {
                            relayId: relay.id,
                            relayName: relay.name,
                            host: relay.host,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        // Record send failure for health tracking
                        await (0, relay_health_check_service_1.recordRelaySendFailure)(relay.id);
                    }
                }
                if (lastError) {
                    throw lastError instanceof Error
                        ? lastError
                        : new Error("All active SMTP relays failed to send the message.");
                }
                return null;
            };
            try {
                const mappedRelayResult = await attemptRelaySet(relays);
                if (mappedRelayResult) {
                    return mappedRelayResult;
                }
            }
            catch (mappedRelayError) {
                // If mapped relays exist but all of them fail, attempt non-mapped active relays.
                const fallbackRelays = activeRelays.filter((relay) => !relays.some((mappedRelay) => mappedRelay.id === relay.id));
                if (fallbackRelays.length > 0) {
                    logger_1.logger.warn("Mapped relays failed; falling back to remaining active relays", {
                        sendingDomain,
                        mappedRelayIds,
                        fallbackRelayIds: fallbackRelays.map((relay) => relay.id),
                        error: mappedRelayError instanceof Error
                            ? mappedRelayError.message
                            : String(mappedRelayError),
                    });
                    const fallbackResult = await attemptRelaySet(fallbackRelays);
                    if (fallbackResult) {
                        return fallbackResult;
                    }
                }
                throw mappedRelayError;
            }
        }
    }
    return sendViaSmtpWithSettings(options, source, mailSettings, replyToAddresses);
};
const verifyMailProvider = async (overrides = {}) => {
    const mailSettings = await resolveMailSettings(overrides);
    if (mailSettings.provider === "smtp") {
        if (!hasExplicitSmtpOverride(overrides)) {
            const relays = await (0, smtp_relay_service_1.getActiveSmtpRelays)();
            if (relays.length > 0) {
                await getSmtpTransport(buildMailSettingsFromRelay(mailSettings, relays[0])).verify();
                return;
            }
        }
        await getSmtpTransport(mailSettings).verify();
        return;
    }
    if (!mailSettings.verifiedFromEmail && !process.env.SES_FROM_EMAIL?.trim()) {
        throw new Error("SES provider selected but no verified sender email is configured.");
    }
};
exports.verifyMailProvider = verifyMailProvider;
const sendEmail = async (options, overrides = {}) => {
    const mailSettings = await resolveMailSettings(overrides);
    const requestedFromEmail = options.fromEmail.trim().toLowerCase();
    const requestedDomain = extractDomainFromEmail(requestedFromEmail);
    const canUseRequestedFromEmailAsSource = mailSettings.provider === "smtp" &&
        Boolean(requestedDomain) &&
        (await (0, sending_domain_service_1.isSendingDomainEligible)(requestedDomain, options.userId));
    const configuredSourceEmail = mailSettings.verifiedFromEmail?.trim().toLowerCase() ||
        process.env.MAIL_FROM_EMAIL?.trim().toLowerCase() ||
        (mailSettings.provider === "smtp"
            ? process.env.SMTP_FROM_EMAIL?.trim().toLowerCase()
            : process.env.SES_FROM_EMAIL?.trim().toLowerCase()) ||
        requestedFromEmail;
    const effectiveSourceEmail = canUseRequestedFromEmailAsSource
        ? requestedFromEmail
        : configuredSourceEmail || requestedFromEmail;
    if (!effectiveSourceEmail) {
        throw new Error("No sender email is configured for the selected mail provider.");
    }
    const replyToAddresses = requestedFromEmail &&
        requestedFromEmail.toLowerCase() !== effectiveSourceEmail.toLowerCase()
        ? [requestedFromEmail]
        : undefined;
    // Sanitize fromName: remove/replace special chars that SMTP providers reject
    // Keep alphanumeric, spaces, hyphens, and common display name chars
    const sanitizedName = String(options.fromName || "Maileff")
        .replace(/[\r\n]+/g, " ") // Remove newlines
        .replace(/[^\w\s\-'\.]/g, "") // Keep only word chars, spaces, hyphen, apostrophe, period
        .replace(/\s+/g, " ") // Normalize multiple spaces to single space
        .trim();
    const safeFromName = sanitizedName || "Maileff";
    const sesSource = `${safeFromName} <${effectiveSourceEmail}>`;
    const smtpSource = `${safeFromName} <${effectiveSourceEmail}>`;
    if (mailSettings.provider === "smtp") {
        return sendViaSmtp(options, smtpSource, mailSettings, replyToAddresses, overrides);
    }
    return sendViaSes(options, sesSource, mailSettings, replyToAddresses);
};
exports.sendEmail = sendEmail;
//# sourceMappingURL=mailer.service.js.map