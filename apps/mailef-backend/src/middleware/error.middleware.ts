import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { AuthRequest } from "../types";

export const errorHandler = (
  err: Error,
  req: AuthRequest,
  res: Response,
  _next: NextFunction
): void => {
  logger.error(err.message, {
    stack: err.stack,
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    userId: req.userId,
    userRole: req.userRole,
    ipAddress: req.requestIp,
  });
  res.status(500).json({ message: err.message || "Internal server error" });
};

export const notFound = (_req: Request, res: Response, _next: NextFunction): void => {
  res.status(404).json({ message: "Route not found" });
};
