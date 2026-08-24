import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest } from "../types";

export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  // Support Authorization header (Bearer <token>) and ?token= query param
  // (needed for iframe embeds like Bull Board which can't set custom headers).
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (typeof req.query.token === "string" && req.query.token.length > 0) {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ message: "No token provided" });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      role?: "user" | "admin" | "super_admin";
    };
    req.userId = decoded.userId;
    req.userRole = decoded.role || "user";
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

export const authorizeRoles =
  (...allowedRoles: Array<"user" | "admin" | "super_admin">) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const role = req.userRole || "user";
    if (!allowedRoles.includes(role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
  };
