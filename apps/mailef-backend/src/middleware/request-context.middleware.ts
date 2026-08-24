import { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { AuthRequest } from "../types";

const getIpAddress = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket.remoteAddress || "unknown";
};

export const attachRequestContext = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.requestId = requestId;
  req.requestIp = getIpAddress(req);
  req.requestUserAgent = String(req.headers["user-agent"] || "unknown");

  res.setHeader("x-request-id", requestId);
  next();
};
