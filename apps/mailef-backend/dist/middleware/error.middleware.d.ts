import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types";
export declare const errorHandler: (err: Error, req: AuthRequest, res: Response, _next: NextFunction) => void;
export declare const notFound: (_req: Request, res: Response, _next: NextFunction) => void;
//# sourceMappingURL=error.middleware.d.ts.map