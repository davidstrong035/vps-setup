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
const AuditLogSchema = new mongoose_1.Schema({
    actorType: {
        type: String,
        enum: ["system", "user"],
        required: true,
        immutable: true,
        index: true,
    },
    actorId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", immutable: true, index: true },
    actorRole: {
        type: String,
        enum: ["user", "admin", "super_admin"],
        immutable: true,
        index: true,
    },
    action: { type: String, required: true, immutable: true, index: true },
    resourceType: { type: String, required: true, immutable: true, index: true },
    resourceId: { type: String, immutable: true, index: true },
    targetUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", immutable: true, index: true },
    status: {
        type: String,
        enum: ["success", "failure"],
        required: true,
        immutable: true,
        index: true,
    },
    requestId: { type: String, immutable: true, index: true },
    ipAddress: { type: String, immutable: true, index: true },
    userAgent: { type: String, immutable: true },
    metadata: { type: mongoose_1.Schema.Types.Mixed, immutable: true },
}, {
    timestamps: true,
    versionKey: false,
});
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ targetUserId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
exports.default = mongoose_1.default.model("AuditLog", AuditLogSchema);
//# sourceMappingURL=AuditLog.model.js.map