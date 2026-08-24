import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
export declare const authenticate: (req: AuthRequest, res: Response, next: NextFunction) => void;
export declare const authorizeRoles: (...allowedRoles: Array<"user" | "admin" | "super_admin">) => (req: AuthRequest, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.middleware.d.ts.map