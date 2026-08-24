"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendingDomain = void 0;
const mongoose_1 = require("mongoose");
const SendingDomainSchema = new mongoose_1.Schema({
    bounceCount: { type: Number, default: 0 },
    complaintCount: { type: Number, default: 0 },
    lastBounceAt: { type: Date },
    lastComplaintAt: { type: Date },
    blocklisted: { type: Boolean, default: false },
    cooldownUntil: { type: Date },
    verificationStatus: {
        type: String,
        enum: ['pending', 'verified', 'failed'],
        default: 'pending',
    },
    domain: { type: String, required: true, unique: true, trim: true, lowercase: true },
    dkimSelector: { type: String },
    dkimPublicKey: { type: String },
    spfRecord: { type: String },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    reputationScore: { type: Number, default: 100 },
    dailyQuota: { type: Number },
    usedToday: { type: Number, default: 0 },
    notes: { type: String },
    smtpRelayIds: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'SmtpRelay' }],
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
}, {
    timestamps: true,
});
exports.SendingDomain = (0, mongoose_1.model)('SendingDomain', SendingDomainSchema);
//# sourceMappingURL=SendingDomain.model.js.map