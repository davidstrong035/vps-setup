import { AuthRequest } from "../types";
type AuditStatus = "success" | "failure";
type AuditActorType = "system" | "user";
interface AuditEventInput {
    actorType?: AuditActorType;
    actorId?: string;
    actorRole?: "user" | "admin" | "super_admin";
    action: string;
    resourceType: string;
    resourceId?: string;
    targetUserId?: string;
    status: AuditStatus;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
}
export declare const logAuditEvent: (input: AuditEventInput) => Promise<void>;
export declare const logAuditFromRequest: (req: AuthRequest, params: Omit<AuditEventInput, "actorId" | "actorRole" | "requestId" | "ipAddress" | "userAgent" | "actorType">) => Promise<void>;
export {};
//# sourceMappingURL=audit-log.service.d.ts.map