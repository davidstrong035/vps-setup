import { type ISendingDomain } from '../models/SendingDomain.model';
export declare function getEligibleSendingDomains(options?: {
    activeRelayIds?: string[];
    userId?: string | null;
}): Promise<ISendingDomain[]>;
export declare function getAvailableSendingDomainNames(): Promise<{
    domains: string[];
    defaultDomain: string | null;
}>;
export declare function getMappedSmtpRelayIdsForDomain(domain?: string | null): Promise<string[] | null>;
export declare function getVerifiedDomainForRelay(relayId: string, userId?: string | null): Promise<string | null>;
export declare function isSendingDomainEligible(domain?: string | null, userId?: string | null): Promise<boolean>;
export declare function selectSendingDomain(preferredDomain?: string | null, userId?: string | null): Promise<string | null>;
//# sourceMappingURL=sending-domain.service.d.ts.map