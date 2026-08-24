"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachRequestContext = void 0;
const crypto_1 = require("crypto");
const getIpAddress = (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || req.socket.remoteAddress || "unknown";
};
const attachRequestContext = (req, res, next) => {
    const requestId = req.headers["x-request-id"] || (0, crypto_1.randomUUID)();
    req.requestId = requestId;
    req.requestIp = getIpAddress(req);
    req.requestUserAgent = String(req.headers["user-agent"] || "unknown");
    res.setHeader("x-request-id", requestId);
    next();
};
exports.attachRequestContext = attachRequestContext;
//# sourceMappingURL=request-context.middleware.js.map