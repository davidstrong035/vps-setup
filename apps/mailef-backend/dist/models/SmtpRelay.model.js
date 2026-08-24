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
const SmtpRelaySchema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true },
    host: { type: String, required: true, trim: true, lowercase: true },
    port: { type: Number, required: true, min: 1, max: 65535, default: 587 },
    username: { type: String, trim: true },
    password: { type: String },
    secure: { type: Boolean, default: false },
    tlsRejectUnauthorized: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
    weight: { type: Number, min: 1, default: 1 },
    sentToday: { type: Number, min: 0, default: 0 },
    usageDate: { type: String, trim: true },
    lastUsedAt: { type: Date },
    notes: { type: String, trim: true, maxlength: 1000 },
    healthStatus: { type: String, enum: ["unknown", "healthy", "degraded", "down"], default: "unknown" },
    consecutiveFailures: { type: Number, min: 0, default: 0 },
    lastHealthCheckAt: { type: Date },
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
}, { timestamps: true });
SmtpRelaySchema.index({ isArchived: 1, isActive: 1 });
SmtpRelaySchema.index({ usageDate: 1, sentToday: 1 });
exports.default = mongoose_1.default.model("SmtpRelay", SmtpRelaySchema);
//# sourceMappingURL=SmtpRelay.model.js.map