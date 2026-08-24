"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEmailSyntax = validateEmailSyntax;
exports.isDisposableDomain = isDisposableDomain;
exports.hasMxRecord = hasMxRecord;
exports.batchValidateMxRecords = batchValidateMxRecords;
exports.validateRecipientEmail = validateRecipientEmail;
exports.clearMxCache = clearMxCache;
exports.getMxCacheSize = getMxCacheSize;
const dns_1 = require("dns");
const logger_1 = require("../utils/logger");
// ---------------------------------------------------------------------------
// RFC 5321 simplified email validation regex
// ---------------------------------------------------------------------------
// This allows: user@domain.tld, user+tag@domain.tld, etc.
// It does NOT do a full RFC 5322 parse — that would be excessive for email sending.
const EMAIL_REGEX = /^(?:(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*)|(?:".+"))@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
// ---------------------------------------------------------------------------
// Disposable email domains list
// ---------------------------------------------------------------------------
const DISPOSABLE_DOMAINS = new Set([
    // Common disposable / temporary email providers
    "mailinator.com",
    "guerrillamail.com",
    "guerrillamail.org",
    "guerrillamail.net",
    "guerrillamail.biz",
    "guerrillamail.de",
    "guerrillamail.co.uk",
    "guerrillamailblock.com",
    "10minutemail.com",
    "10minutemail.net",
    "10minutemail.org",
    "tempmail.com",
    "tempmail.net",
    "tempmail.org",
    "throwaway.email",
    "throwawayemail.com",
    "yopmail.com",
    "yopmail.fr",
    "yopmail.net",
    "sharklasers.com",
    "grr.la",
    "trashmail.com",
    "trashmail.net",
    "trashmail.org",
    "trashmail.me",
    "maildrop.cc",
    "maildrop.org",
    "getairmail.com",
    "getairmail.org",
    "airmailhub.com",
    "emailondeck.com",
    "mailnator.com",
    "temp-mail.org",
    "temp-mail.com",
    "temp-mail.net",
    "tempinbox.com",
    "mail.tm",
    "tempmail.co",
    "tempmail.io",
    "spamgourmet.com",
    "spamgourmet.org",
    "spamgourmet.net",
    "spam.la",
    "mailexpire.com",
    "mailmetrash.com",
    "mailcatch.com",
    "fakeinbox.com",
    "fake-mail.com",
    "fakemail.com",
    "fakemailgenerator.com",
    "mailgenerator.com",
    "mintemail.com",
    "mohmal.com",
    "mohmal.org",
    "mohmal.net",
    "mohmal.de",
    "mohmal.in",
    "email-fake.com",
    "emailfake.com",
    "emailfake.ml",
    "emailfake.ga",
    "emailfake.gq",
    "emailfake.tk",
    "emailfake.cf",
    "emailnator.com",
    "disposable.com",
    "dispostable.com",
    "mailnull.com",
    "mailnull.net",
    "mailnull.org",
    "spambox.com",
    "spambox.us",
    "spambox.info",
    "spambox.me",
    "spambox.org",
    "spambox.net",
    "spambox.de",
    "spambox.fr",
    "spambox.io",
    "spambox.in",
    "spambox.pro",
    "spambox.xyz",
    "spambox.online",
    "spambox.site",
    "spambox.space",
    "spambox.tech",
    "spambox.live",
    "spambox.store",
    "spambox.cloud",
    "spambox.digital",
    "spambox.website",
    "spambox.work",
    "spambox.biz",
    "spambox.info",
    "spambox.name",
    "spambox.net",
    "spambox.org",
    "spambox.pro",
    "spambox.rocks",
    "spambox.shop",
    "spambox.us",
    "spambox.xyz",
    "mailnesia.com",
    "mailnesia.net",
    "mailnesia.org",
    "mailexpire.com",
    "mailexpire.net",
    "mailexpire.org",
    "emailense.com",
    "emailense.net",
    "emailense.org",
    "tempinbox.co",
    "tempinbox.net",
    "tempinbox.org",
    "tempinbox.xyz",
    "1shivom.com",
    "1shivom.net",
    "1shivom.org",
    "1shivom.xyz",
    "1shivom.in",
    "1shivom.me",
    "1shivom.co",
    "1shivom.io",
    "1shivom.pro",
    "1shivom.tech",
    "1shivom.online",
    "1shivom.site",
    "1shivom.space",
    "1shivom.store",
    "1shivom.cloud",
    "1shivom.digital",
    "1shivom.website",
    "1shivom.work",
    "1shivom.biz",
    "1shivom.info",
    "1shivom.name",
    "1shivom.net",
    "1shivom.org",
    "1shivom.pro",
    "1shivom.rocks",
    "1shivom.shop",
    "1shivom.us",
    "1shivom.xyz",
    "mailmetrash.com",
    "mailmetrash.net",
    "mailmetrash.org",
    "mailmetrash.xyz",
    "trash2009.com",
    "trash2009.net",
    "trash2009.org",
    "trash2009.xyz",
    "trash2010.com",
    "trash2010.net",
    "trash2010.org",
    "trash2010.xyz",
    "trash2011.com",
    "trash2011.net",
    "trash2011.org",
    "trash2011.xyz",
    "trash2012.com",
    "trash2012.net",
    "trash2012.org",
    "trash2012.xyz",
    "trash2013.com",
    "trash2013.net",
    "trash2013.org",
    "trash2013.xyz",
    "trash2014.com",
    "trash2014.net",
    "trash2014.org",
    "trash2014.xyz",
    "trash2015.com",
    "trash2015.net",
    "trash2015.org",
    "trash2015.xyz",
    "trash2016.com",
    "trash2016.net",
    "trash2016.org",
    "trash2016.xyz",
    "trash2017.com",
    "trash2017.net",
    "trash2017.org",
    "trash2017.xyz",
    "trash2018.com",
    "trash2018.net",
    "trash2018.org",
    "trash2018.xyz",
    "trash2019.com",
    "trash2019.net",
    "trash2019.org",
    "trash2019.xyz",
    "trash2020.com",
    "trash2020.net",
    "trash2020.org",
    "trash2020.xyz",
    "trash2021.com",
    "trash2021.net",
    "trash2021.org",
    "trash2021.xyz",
    "trash2022.com",
    "trash2022.net",
    "trash2022.org",
    "trash2022.xyz",
    "trash2023.com",
    "trash2023.net",
    "trash2023.org",
    "trash2023.xyz",
    "trash24.com",
    "trash24.net",
    "trash24.org",
    "trash24.xyz",
    "trashdevil.com",
    "trashdevil.net",
    "trashdevil.org",
    "trashdevil.xyz",
    "trashymail.com",
    "trashymail.net",
    "trashymail.org",
    "trashymail.xyz",
    "trashymail.co",
    "trashymail.io",
    "trashymail.pro",
    "trashymail.tech",
    "trashymail.online",
    "trashymail.site",
    "trashymail.space",
    "trashymail.store",
    "trashymail.cloud",
    "trashymail.digital",
    "trashymail.website",
    "trashymail.work",
    "trashymail.biz",
    "trashymail.info",
    "trashymail.name",
    "trashymail.net",
    "trashymail.org",
    "trashymail.pro",
    "trashymail.rocks",
    "trashymail.shop",
    "trashymail.us",
    "trashymail.xyz",
    "maildrop.cc",
    "maildrop.org",
    "maildrop.net",
    "maildrop.xyz",
    "maildrop.co",
    "maildrop.io",
    "maildrop.pro",
    "maildrop.tech",
    "maildrop.online",
    "maildrop.site",
    "maildrop.space",
    "maildrop.store",
    "maildrop.cloud",
    "maildrop.digital",
    "maildrop.website",
    "maildrop.work",
    "maildrop.biz",
    "maildrop.info",
    "maildrop.name",
    "maildrop.net",
    "maildrop.org",
    "maildrop.pro",
    "maildrop.rocks",
    "maildrop.shop",
    "maildrop.us",
    "maildrop.xyz",
]);
// ---------------------------------------------------------------------------
// MX lookup cache
// ---------------------------------------------------------------------------
const MX_CACHE_TTL_MS = Math.max(Number(process.env.EMAIL_VALIDATION_MX_CACHE_TTL_MS) || 3600000, // 1 hour default
60000);
// In-memory cache for MX lookups (domain -> hasMx)
const mxCache = new Map();
// ---------------------------------------------------------------------------
// Syntax validation
// ---------------------------------------------------------------------------
function validateEmailSyntax(email) {
    const trimmed = String(email || "").trim();
    if (!trimmed) {
        return { valid: false, email, canonicalEmail: "", reason: "Empty email address" };
    }
    const canonicalEmail = trimmed.toLowerCase();
    if (canonicalEmail.length > 254) {
        return { valid: false, email, canonicalEmail, reason: "Email address is too long (max 254 characters)" };
    }
    if (!EMAIL_REGEX.test(canonicalEmail)) {
        return { valid: false, email, canonicalEmail, reason: "Invalid email format" };
    }
    // Check local part length (before @)
    const localPart = canonicalEmail.split("@")[0];
    if (localPart.length > 64) {
        return { valid: false, email, canonicalEmail, reason: "Local part of email is too long (max 64 characters)" };
    }
    return { valid: true, email, canonicalEmail };
}
// ---------------------------------------------------------------------------
// Disposable domain check
// ---------------------------------------------------------------------------
function isDisposableDomain(domain) {
    const normalizedDomain = domain.trim().toLowerCase();
    return DISPOSABLE_DOMAINS.has(normalizedDomain);
}
// ---------------------------------------------------------------------------
// MX record lookup with caching
// ---------------------------------------------------------------------------
async function hasMxRecord(domain) {
    const normalizedDomain = domain.trim().toLowerCase();
    if (!normalizedDomain) {
        return false;
    }
    const now = Date.now();
    const cached = mxCache.get(normalizedDomain);
    if (cached && now - cached.cachedAt < MX_CACHE_TTL_MS) {
        return cached.hasMx;
    }
    try {
        const mxRecords = await dns_1.promises.resolveMx(normalizedDomain);
        // A valid MX record exists with priority > 0
        const hasValidMx = mxRecords.some((record) => record.exchange && record.exchange.length > 0 && record.priority >= 0);
        mxCache.set(normalizedDomain, { hasMx: hasValidMx, cachedAt: now });
        if (!hasValidMx) {
            logger_1.logger.debug("No valid MX records found for domain", { domain: normalizedDomain, mxRecords });
        }
        return hasValidMx;
    }
    catch (error) {
        const err = error;
        // ENOTFOUND / ENODATA — domain does not exist or has no MX records
        if (err.code === "ENOTFOUND" || err.code === "ENODATA" || err.code === "ESERVFAIL" || err.code === "EREFUSED") {
            mxCache.set(normalizedDomain, { hasMx: false, cachedAt: now });
            return false;
        }
        // For other DNS errors, log and return false (don't cache aggressive failures)
        logger_1.logger.warn("DNS MX lookup failed unexpectedly", {
            domain: normalizedDomain,
            code: err.code,
            message: err.message,
        });
        return false;
    }
}
/**
 * Given an array of emails, deduplicates by domain, performs MX lookups,
 * and returns which emails have valid domains vs invalid ones.
 *
 * This is more efficient than per-email lookups when many emails share the same domain.
 */
async function batchValidateMxRecords(emails) {
    const valid = [];
    const invalid = [];
    // Deduplicate by domain to minimize DNS lookups
    const domainToEmails = new Map();
    for (const email of emails) {
        const trimmed = String(email || "").trim().toLowerCase();
        if (!trimmed.includes("@")) {
            invalid.push({ email, reason: "Missing @ symbol" });
            continue;
        }
        const domain = trimmed.split("@")[1];
        if (!domain) {
            invalid.push({ email, reason: "Empty domain portion" });
            continue;
        }
        const existing = domainToEmails.get(domain) || [];
        existing.push(trimmed);
        domainToEmails.set(domain, existing);
    }
    // Look up MX for each unique domain
    for (const [domain, domainEmails] of domainToEmails) {
        const hasMx = await hasMxRecord(domain);
        if (hasMx) {
            for (const email of domainEmails) {
                valid.push(email);
            }
        }
        else {
            for (const email of domainEmails) {
                invalid.push({ email, reason: `Domain ${domain} has no valid MX records` });
            }
        }
    }
    return { valid, invalid };
}
// ---------------------------------------------------------------------------
// Full validation pipeline
// ---------------------------------------------------------------------------
async function validateRecipientEmail(email) {
    // 1. Syntax check
    const syntaxCheck = validateEmailSyntax(email);
    if (!syntaxCheck.valid) {
        return syntaxCheck;
    }
    // 2. Disposable domain check
    const domain = syntaxCheck.canonicalEmail.split("@")[1];
    if (isDisposableDomain(domain)) {
        return {
            valid: false,
            email,
            canonicalEmail: syntaxCheck.canonicalEmail,
            reason: "Disposable/temporary email addresses are not allowed",
        };
    }
    // 3. MX record check
    const hasMx = await hasMxRecord(domain);
    if (!hasMx) {
        return {
            valid: false,
            email,
            canonicalEmail: syntaxCheck.canonicalEmail,
            reason: `Domain ${domain} does not accept email (no MX records found)`,
        };
    }
    return { valid: true, email, canonicalEmail: syntaxCheck.canonicalEmail };
}
// ---------------------------------------------------------------------------
// Cache management (for testing/monitoring)
// ---------------------------------------------------------------------------
function clearMxCache() {
    mxCache.clear();
}
function getMxCacheSize() {
    return mxCache.size;
}
//# sourceMappingURL=email-validation.service.js.map