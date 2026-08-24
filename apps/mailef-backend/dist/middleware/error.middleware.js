"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = exports.errorHandler = void 0;
const logger_1 = require("../utils/logger");
const errorHandler = (err, req, res, _next) => {
    logger_1.logger.error(err.message, {
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
exports.errorHandler = errorHandler;
const notFound = (_req, res, _next) => {
    res.status(404).json({ message: "Route not found" });
};
exports.notFound = notFound;
//# sourceMappingURL=error.middleware.js.map