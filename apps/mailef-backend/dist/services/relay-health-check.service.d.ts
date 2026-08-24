/**
 * Marks a relay failure from a live send attempt (not a health check probe).
 * This is called by the mailer when sending through a relay fails.
 */
export declare const recordRelaySendFailure: (relayId: string) => Promise<void>;
/**
 * Marks a relay send success. Resets consecutive failures.
 */
export declare const recordRelaySendSuccess: (relayId: string) => Promise<void>;
export declare const startRelayHealthChecker: () => void;
export declare const stopRelayHealthChecker: () => void;
//# sourceMappingURL=relay-health-check.service.d.ts.map