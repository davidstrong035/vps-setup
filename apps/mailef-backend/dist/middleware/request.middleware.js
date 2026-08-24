"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = void 0;
const morgan_1 = __importDefault(require("morgan"));
const logger_1 = require("../utils/logger");
morgan_1.default.token("request-id", (req) => req.headers["x-request-id"]);
morgan_1.default.token("user-id", (req) => req.userId || "anonymous");
morgan_1.default.token("user-role", (req) => req.userRole || "guest");
morgan_1.default.token("client-ip", (req, res) => req.ip || req.socket.remoteAddress || "unknown");
// stream morgan output through Winston
const stream = {
    write: (message) => {
        logger_1.logger.http(message.trim());
    },
};
exports.requestLogger = (0, morgan_1.default)(":method :url :status :res[content-length] - :response-time ms requestId=:request-id userId=:user-id role=:user-role ip=:client-ip", { stream });
//# sourceMappingURL=request.middleware.js.map