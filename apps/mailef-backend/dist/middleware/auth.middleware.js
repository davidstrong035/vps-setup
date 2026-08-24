"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeRoles = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authenticate = (req, res, next) => {
    // Support Authorization header (Bearer <token>) and ?token= query param
    // (needed for iframe embeds like Bull Board which can't set custom headers).
    const authHeader = req.headers.authorization;
    let token;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
    }
    else if (typeof req.query.token === "string" && req.query.token.length > 0) {
        token = req.query.token;
    }
    if (!token) {
        res.status(401).json({ message: "No token provided" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        req.userRole = decoded.role || "user";
        next();
    }
    catch {
        res.status(401).json({ message: "Invalid or expired token" });
    }
};
exports.authenticate = authenticate;
const authorizeRoles = (...allowedRoles) => (req, res, next) => {
    const role = req.userRole || "user";
    if (!allowedRoles.includes(role)) {
        res.status(403).json({ message: "Forbidden" });
        return;
    }
    next();
};
exports.authorizeRoles = authorizeRoles;
//# sourceMappingURL=auth.middleware.js.map