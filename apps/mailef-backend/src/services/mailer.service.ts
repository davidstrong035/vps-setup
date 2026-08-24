import nodemailer from "nodemailer";
import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient } from "../config/ses";
import {
  getPlatformMailSettings,
  type RuntimeMailSettings,
} from "./platform-settings.service";
import {
  getActiveSmtpRelays,
  markSmtpRelayUsed,
  type RuntimeSmtpRelay,
} from "./smtp-relay.service";
import { recordRelaySendFailure, recordRelaySendSuccess } from "./relay-health-check.service";
import {
  getMappedSmtpRelayIdsForDomain,
  getVerifiedDomainForRelay,
  isSendingDomainEligible,
} from "./sending-domain.service";
import { logger } from "../utils/logger";

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
  userId?: string | null;
}

const smtpTransportCache = new Map<string, nodemailer.Transporter>();
const smtpConnectionTimeoutMs = Math.max(
  Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 15_000,
  1_000
);
const smtpGreetingTimeoutMs = Math.max(
  Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 15_000,
  1_000
);
const smtpSocketTimeoutMs = Math.max(
  Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 60_000,
  5_000
);

const filterMailSettingOverrides = (
  overrides: Partial<RuntimeMailSettings> = {}
): Partial<RuntimeMailSettings> =>
  Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string" && value.trim() === "") return false;
      return true;
    })
  ) as Partial<RuntimeMailSettings>;

const hasExplicitSmtpOverride = (
  overrides: Partial<RuntimeMailSettings> = {}
): boolean => {
  const smtpFields: Array<keyof RuntimeMailSettings> = [
    "smtpHost",
    "smtpPort",
    "smtpUsername",
    "smtpPassword",
    "smtpSecure",
    "smtpTlsRejectUnauthorized",
  ];

  return smtpFields.some((field) => Object.prototype.hasOwnProperty.call(overrides, field));
};

const resolveMailSettings = async (
  overrides: Partial<RuntimeMailSettings> = {}
): Promise<RuntimeMailSettings> => {
  const current = await getPlatformMailSettings();
  const filteredOverrides = filterMailSettingOverrides(overrides);

  return {
    ...current,
    ...filteredOverrides,
  };
};

const getSmtpTransport = (mailSettings: RuntimeMailSettings): nodemailer.Transporter => {
  const host = mailSettings.smtpHost?.trim();
  const requestedPort = Number(mailSettings.smtpPort || "");
  const secure = Boolean(mailSettings.smtpSecure) || requestedPort === 465;
  const port =
    Number.isFinite(requestedPort) && requestedPort > 0
      ? requestedPort
      : secure
        ? 465
        : 587;
  const user = mailSettings.smtpUsername?.trim();
  const pass = mailSettings.smtpPassword;

  if (!host) {
    throw new Error(
      "SMTP provider selected but no SMTP host is configured in Platform Mail Settings."
    );
  }

  if (user && !pass) {
    throw new Error(
      "SMTP provider selected but no SMTP password is configured in Platform Mail Settings."
    );
  }

  const transportKey = `${host}:${port}:${secure}:${user || ""}:${pass ? "set" : "empty"}:${mailSettings.smtpTlsRejectUnauthorized}`;
  const cached = smtpTransportCache.get(transportKey);
  if (cached) {
    return cached;
  }

  const transport = nodemailer.createTransport({
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

const buildMailSettingsFromRelay = (
  mailSettings: RuntimeMailSettings,
  relay: RuntimeSmtpRelay
): RuntimeMailSettings => ({
  ...mailSettings,
  smtpHost: relay.host,
  smtpPort: relay.port,
  smtpUsername: relay.username,
  smtpPassword: relay.password,
  smtpSecure: relay.secure,
  smtpTlsRejectUnauthorized: relay.tlsRejectUnauthorized,
});

const sendViaSes = async (
  options: SendMailOptions,
  source: string,
  mailSettings: RuntimeMailSettings,
  replyToAddresses?: string[]
): Promise<string> => {
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

  const configurationSetName =
    mailSettings.configurationSetName || process.env.SES_CONFIGURATION_SET?.trim();

  try {
    const result = await sesClient.send(
      new SendEmailCommand({
        Source: source,
        Destination: { ToAddresses: [options.to] },
        ...(replyToAddresses ? { ReplyToAddresses: replyToAddresses } : {}),
        Message: message,
        ...(configurationSetName
          ? { ConfigurationSetName: configurationSetName }
          : {}),
      })
    );
    return result.MessageId ?? "";
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    const missingConfigSet =
      err?.name === "ConfigurationSetDoesNotExistException" ||
      (((err?.message ?? "").includes("Configuration set")) &&
        (err?.message ?? "").includes("does not exist"));

    if (configurationSetName && missingConfigSet) {
      logger.warn(
        "SES configuration set not found, retrying send without configuration set",
        {
          configurationSetName,
          to: options.to,
        }
      );

      const result = await sesClient.send(
        new SendEmailCommand({
          Source: source,
          Destination: { ToAddresses: [options.to] },
          ...(replyToAddresses ? { ReplyToAddresses: replyToAddresses } : {}),
          Message: message,
        })
      );

      return result.MessageId ?? "";
    }

    throw error;
  }
};

const sendViaSmtpWithSettings = async (
  options: SendMailOptions,
  source: string,
  mailSettings: RuntimeMailSettings,
  replyToAddresses?: string[],
  senderDomain?: string | null
): Promise<string> => {
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

const extractDomainFromEmail = (email?: string): string => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) return "";
  return normalizedEmail.split("@")[1] || "";
};

const sendViaSmtp = async (
  options: SendMailOptions,
  source: string,
  mailSettings: RuntimeMailSettings,
  replyToAddresses?: string[],
  overrides: Partial<RuntimeMailSettings> = {}
): Promise<string> => {
  if (!hasExplicitSmtpOverride(overrides)) {
    // Always derive relay mapping from the effective SMTP source address.
    // This prevents stale campaign fromEmail values from forcing wrong relay mapping.
    const sourceDomain = extractDomainFromEmail(source);
    const requestedDomain = extractDomainFromEmail(options.fromEmail);
    const sendingDomain = sourceDomain || requestedDomain;
    const mappedRelayIds = await getMappedSmtpRelayIdsForDomain(sendingDomain);
    const activeRelays = await getActiveSmtpRelays(options.userId);
    let relays = activeRelays.filter((relay) => {
      if (!mappedRelayIds || mappedRelayIds.length === 0) return true;
      return mappedRelayIds.includes(relay.id);
    });

    if (mappedRelayIds && mappedRelayIds.length > 0 && relays.length === 0) {
      // Mapping can become stale when relays are disabled/replaced. Fall back to active
      // relays instead of blocking all sends for the domain.
      logger.warn(
        "No active relay matched domain mapping, falling back to all active relays",
        {
          sendingDomain,
          mappedRelayIds,
          activeRelayIds: activeRelays.map((relay) => relay.id),
        }
      );
      relays = activeRelays;
    }

    if (relays.length > 0) {
      const attemptRelaySet = async (candidateRelays: RuntimeSmtpRelay[]): Promise<string | null> => {
        let lastError: unknown = null;

        for (const relay of candidateRelays) {
          try {
            const relaySettings = buildMailSettingsFromRelay(mailSettings, relay);
            const senderDomain = await getVerifiedDomainForRelay(relay.id, options.userId);
            const messageId = await sendViaSmtpWithSettings(
              options,
              source,
              relaySettings,
              replyToAddresses,
              senderDomain
            );
            await markSmtpRelayUsed(relay.id);
            // Record send success for health tracking
            await recordRelaySendSuccess(relay.id);
            return messageId;
          } catch (error) {
            lastError = error;
            logger.warn("SMTP relay failed, trying the next active relay", {
              relayId: relay.id,
              relayName: relay.name,
              host: relay.host,
              error: error instanceof Error ? error.message : String(error),
            });
            // Record send failure for health tracking
            await recordRelaySendFailure(relay.id);
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
      } catch (mappedRelayError) {
        // If mapped relays exist but all of them fail, attempt non-mapped active relays.
        const fallbackRelays = activeRelays.filter(
          (relay) => !relays.some((mappedRelay) => mappedRelay.id === relay.id)
        );

        if (fallbackRelays.length > 0) {
          logger.warn(
            "Mapped relays failed; falling back to remaining active relays",
            {
              sendingDomain,
              mappedRelayIds,
              fallbackRelayIds: fallbackRelays.map((relay) => relay.id),
              error:
                mappedRelayError instanceof Error
                  ? mappedRelayError.message
                  : String(mappedRelayError),
            }
          );

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

export const verifyMailProvider = async (
  overrides: Partial<RuntimeMailSettings> = {}
): Promise<void> => {
  const mailSettings = await resolveMailSettings(overrides);

  if (mailSettings.provider === "smtp") {
    if (!hasExplicitSmtpOverride(overrides)) {
      const relays = await getActiveSmtpRelays();
      if (relays.length > 0) {
        await getSmtpTransport(buildMailSettingsFromRelay(mailSettings, relays[0])).verify();
        return;
      }
    }

    await getSmtpTransport(mailSettings).verify();
    return;
  }

  if (!mailSettings.verifiedFromEmail && !process.env.SES_FROM_EMAIL?.trim()) {
    throw new Error(
      "SES provider selected but no verified sender email is configured."
    );
  }
};

export const sendEmail = async (
  options: SendMailOptions,
  overrides: Partial<RuntimeMailSettings> = {}
): Promise<string> => {
  const mailSettings = await resolveMailSettings(overrides);
  const requestedFromEmail = options.fromEmail.trim().toLowerCase();
  const requestedDomain = extractDomainFromEmail(requestedFromEmail);
  const canUseRequestedFromEmailAsSource =
    mailSettings.provider === "smtp" &&
    Boolean(requestedDomain) &&
    (await isSendingDomainEligible(requestedDomain, options.userId));
  const configuredSourceEmail =
    mailSettings.verifiedFromEmail?.trim().toLowerCase() ||
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

  const replyToAddresses =
    requestedFromEmail &&
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
