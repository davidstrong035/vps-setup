export interface ValidationResult {
    valid: boolean;
    email: string;
    reason?: string;
    /** The validated/canonical email (lowercased, trimmed). */
    canonicalEmail: string;
}
export declare function validateEmailSyntax(email: string): ValidationResult;
export declare function isDisposableDomain(domain: string): boolean;
export declare function hasMxRecord(domain: string): Promise<boolean>;
export interface BatchMxResult {
    valid: string[];
    invalid: Array<{
        email: string;
        reason: string;
    }>;
}
/**
 * Given an array of emails, deduplicates by domain, performs MX lookups,
 * and returns which emails have valid domains vs invalid ones.
 *
 * This is more efficient than per-email lookups when many emails share the same domain.
 */
export declare function batchValidateMxRecords(emails: string[]): Promise<BatchMxResult>;
export declare function validateRecipientEmail(email: string): Promise<ValidationResult>;
export declare function clearMxCache(): void;
export declare function getMxCacheSize(): number;
//# sourceMappingURL=email-validation.service.d.ts.map