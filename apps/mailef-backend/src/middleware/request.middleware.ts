import morgan from "morgan";
import type { Request, Response } from "express";
import { logger } from "../utils/logger";

morgan.token("request-id", (req: Request) => req.headers["x-request-id"] as string);
morgan.token("user-id", (req: Request & { userId?: string }) => req.userId || "anonymous");
morgan.token("user-role", (req: Request & { userRole?: string }) => req.userRole || "guest");
morgan.token("client-ip", (req: Request, res: Response) => req.ip || req.socket.remoteAddress || "unknown");

// stream morgan output through Winston
const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

export const requestLogger = morgan(
  ":method :url :status :res[content-length] - :response-time ms requestId=:request-id userId=:user-id role=:user-role ip=:client-ip",
  { stream }
);
