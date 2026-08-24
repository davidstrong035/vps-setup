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
const CampaignSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    fromName: { type: String, required: true, trim: true },
    fromEmail: { type: String, required: true, trim: true, lowercase: true },
    sendingDomain: { type: String, trim: true, lowercase: true },
    listId: { type: mongoose_1.Schema.Types.ObjectId, ref: "List", required: true },
    templateId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Template" },
    html: { type: String, required: true },
    status: {
        type: String,
        enum: ["draft", "scheduled", "sending", "sent", "paused", "cancelled"],
        default: "draft",
    },
    pauseReason: { type: String, trim: true },
    pausedBy: { type: String, enum: ["user", "admin", "system"], trim: true },
    scheduledAt: { type: Date },
    sentAt: { type: Date },
    dispatchCursorChunkIndex: { type: Number, default: 0, min: 0 },
    dispatchCursorRowOffset: { type: Number, default: 0, min: 0 },
    stats: {
        total: { type: Number, default: 0 },
        sent: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        opened: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 },
        bounced: { type: Number, default: 0 },
        complained: { type: Number, default: 0 },
        unsubscribed: { type: Number, default: 0 },
    },
}, { timestamps: true });
exports.default = mongoose_1.default.model("Campaign", CampaignSchema);
//# sourceMappingURL=Campaign.model.js.map