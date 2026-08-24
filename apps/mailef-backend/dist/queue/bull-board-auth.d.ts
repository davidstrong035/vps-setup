import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
/**
 * Auth middleware for Bull Board that supports three token sources:
 * 1. Authorization header (Bearer <token>) — used by Bull Board's XHR/fetch calls
 * 2. ?token= query param — used for initial iframe load
 * 3. maileff_token cookie — set on initial iframe load for subsequent requests
 */
export default function bullBoardAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction): void;
//# sourceMappingURL=bull-board-auth.d.ts.map