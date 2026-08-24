"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const PlatformSettingsSchema = new mongoose_1.Schema({
    singletonKey: {
        type: String,
        required: true,
        unique: true,
        default: "platform",
    },
    mailProvider: {
        type: String,
        enum: ["ses", "smtp"],
        default: "ses",
    },
    mailDefaultFromName: { type: String, trim: true },
    mailVerifiedFromEmail: { type: String, trim: true, lowercase: true },
    mailConfigurationSetName: { type: String, trim: true },
    smtpHost: { type: String, trim: true },
    smtpPort: { type: Number, min: 1, max: 65535 },
    smtpUsername: { type: String, trim: true },
    smtpPassword: { type: String },
    smtpSecure: { type: Boolean },
    smtpTlsRejectUnauthorized: { type: Boolean },
    dispatchEnabled: { type: Boolean },
    dispatchIntervalMs: { type: Number, min: 2000 },
    dispatchUsersPerTick: { type: Number, min: 1 },
    dispatchMaxPerRun: { type: Number, min: 100 },
    workerConcurrency: { type: Number, min: 1 },
    workerRateLimitMax: { type: Number, min: 1 },
    workerRateLimitDurationMs: { type: Number, min: 100 },
    customIntervalMinutes: { type: Number, min: 1 }, // Send 1 email every X minutes
}, { timestamps: true });
exports.default = mongoose_1.default.model("PlatformSettings", PlatformSettingsSchema);
//# sourceMappingURL=PlatformSettings.model.js.map