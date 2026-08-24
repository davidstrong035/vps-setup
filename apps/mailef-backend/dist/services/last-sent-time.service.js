"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLastSentTime = getLastSentTime;
const mongoose_1 = require("mongoose");
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
async function getLastSentTime(userId) {
    const last = await CampaignRecipient_model_1.default.findOne({
        userId: new mongoose_1.Types.ObjectId(userId),
        status: "sent",
    })
        .sort({ sentAt: -1 })
        .select("sentAt")
        .lean();
    return last?.sentAt ? new Date(last.sentAt) : null;
}
//# sourceMappingURL=last-sent-time.service.js.map