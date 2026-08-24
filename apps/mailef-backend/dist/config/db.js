"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./env");
const mongoose_1 = __importDefault(require("mongoose"));
const logger_1 = require("../utils/logger");
const connectDB = async () => {
    const isProduction = process.env.NODE_ENV === "production";
    const uri = isProduction
        ? process.env.MONGODB_URI_PROD || process.env.MONGODB_URI
        : process.env.MONGODB_URI_DEV || process.env.MONGODB_URI;
    if (!uri) {
        logger_1.logger.error(isProduction
            ? "Missing MongoDB URI: set MONGODB_URI_PROD (or MONGODB_URI)"
            : "Missing MongoDB URI: set MONGODB_URI_DEV (or MONGODB_URI)");
        process.exit(1);
    }
    try {
        await mongoose_1.default.connect(uri);
        logger_1.logger.info("MongoDB connected");
    }
    catch (error) {
        logger_1.logger.error("MongoDB connection error", { error });
        process.exit(1);
    }
};
exports.default = connectDB;
//# sourceMappingURL=db.js.map