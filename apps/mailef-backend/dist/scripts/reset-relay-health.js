"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("../config/env");
const mongoose_1 = __importDefault(require("mongoose"));
const SmtpRelay_model_1 = __importDefault(require("../models/SmtpRelay.model"));
const run = async () => {
    await mongoose_1.default.connect(process.env.MONGODB_URI_PROD);
    const result = await SmtpRelay_model_1.default.updateMany({ isArchived: { $ne: true } }, {
        $set: {
            consecutiveFailures: 0,
            healthStatus: "unknown",
            isActive: true,
        },
    });
    console.log(`Reset ${result.modifiedCount} relay(s)`);
    await mongoose_1.default.disconnect();
};
run().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=reset-relay-health.js.map