import { IEmailCreditAllocation } from "../types";
export interface EmailAllocationSnapshot {
    _id: string;
    amountPaid: number;
    currency: string;
    emailsPurchased: number;
    consumedEmails: number;
    reservedEmails: number;
    remainingEmails: number;
    paidAt: Date;
    expiresAt: Date;
    receiptReference?: string;
    note?: string;
    status: "active" | "expired" | "consumed" | "superseded" | "suspended";
    createdAt: Date;
}
export declare const refreshEmailAllocationStatuses: (userId?: string) => Promise<void>;
export declare const createEmailAllocation: (input: {
    userId: string;
    assignedByUserId: string;
    amountPaid: number;
    currency: string;
    emailsPurchased: number;
    paidAt: Date;
    expiresAt: Date;
    receiptReference?: string;
    note?: string;
}) => Promise<IEmailCreditAllocation>;
export declare const getActiveEmailAllocation: (userId: string) => Promise<IEmailCreditAllocation | null>;
export declare const getEmailAllocationSummary: (userId: string) => Promise<{
    currentAllocation: EmailAllocationSnapshot | null;
    recentAllocations: EmailAllocationSnapshot[];
}>;
export declare const reserveEmailCredits: (allocationId: string, count: number) => Promise<IEmailCreditAllocation | null>;
export declare const releaseReservedEmailCredits: (allocationId: string, count: number) => Promise<void>;
export declare const consumeReservedEmailCredits: (allocationId: string, count: number) => Promise<void>;
export declare const suspendEmailAllocation: (allocationId: string, reason?: string) => Promise<IEmailCreditAllocation>;
export declare const updateEmailAllocationPurchasedCount: (input: {
    allocationId: string;
    userId: string;
    emailsPurchased: number;
    note?: string;
}) => Promise<IEmailCreditAllocation>;
export declare const extendEmailAllocation: (input: {
    allocationId: string;
    userId: string;
    newExpiresAt: Date;
    note?: string;
}) => Promise<IEmailCreditAllocation>;
export declare const getUserEmailAllocationHistory: (userId: string, page?: number, limit?: number) => Promise<{
    allocations: EmailAllocationSnapshot[];
    total: number;
    pages: number;
}>;
//# sourceMappingURL=email-allocation.service.d.ts.map