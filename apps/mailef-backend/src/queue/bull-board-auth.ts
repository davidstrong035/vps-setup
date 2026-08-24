import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest } from "../types";

/**
 * Auth middleware for Bull Board that supports three token sources:
 * 1. Authorization header (Bearer <token>) — used by Bull Board's XHR/fetch calls
 * 2. ?token= query param — used for initial iframe load
 * 3. maileff_token cookie — set on initial iframe load for subsequent requests
 */
export default function bullBoardAuthMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  let token: string | undefined;

  // 1. Authorization header (Bull Board internal XHR)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  // 2. Query param (from iframe initial load)
  if (!token && typeof req.query.token === "string" && req.query.token.length > 0) {
    token = req.query.token;
  }

  // 3. Cookie (set on initial iframe load for subsequent requests)
  if (!token && typeof req.cookies?.maileff_token === "string") {
    token = req.cookies.maileff_token;
  }

  // Also set the cookie if token came from query param, for future requests
  if (token && typeof req.query.token === "string") {
    res.cookie("maileff_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.protocol === "https",
      path: "/api",
    });
  }

  if (!token) {
    res.status(401).json({ message: "Unauthorized — no token provided" });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      role?: "user" | "admin" | "super_admin";
    };

    if (decoded.role !== "admin" && decoded.role !== "super_admin") {
      res.status(403).json({ message: "Forbidden — admin access required" });
      return;
    }

    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}