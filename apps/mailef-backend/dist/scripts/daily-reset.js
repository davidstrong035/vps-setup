"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetDailyCounters = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
dotenv_1.default.config();
const mongoUri = process.env.MONGODB_URI_PROD || process.env.MONGODB_URI || process.env.MONGODB_URI_DEV;
if (!mongoUri) {
    console.error("Missing MongoDB URI. Set MONGODB_URI_PROD, MONGODB_URI or MONGODB_URI_DEV.");
    process.exit(1);
}
const ensureCollectionExists = async (db, name) => {
    const list = await db.listCollections({ name }).toArray();
    return list.length > 0;
};
const tasks = [
    // Sending domain per-day usage
    { name: "sendingdomains", update: { $set: { usedToday: 0, lastDailyReset: new Date() } } },
    // Email credit / allocation counters (possible collection names)
    { name: "emailcreditallocations", update: { $set: { usedToday: 0, lastDailyReset: new Date() } } },
    { name: "emailallocations", update: { $set: { usedToday: 0, lastDailyReset: new Date() } } },
    // Per-user daily counters
    { name: "users", update: { $set: { dailySent: 0, lastDailyReset: new Date() } } },
    // Dispatch/pacing state if present
    { name: "dispatchstates", update: { $set: { sentToday: 0, lastDailyReset: new Date() } } },
    // Campaigns: don't modify status, only set lastDailyReset timestamp
    { name: "campaigns", update: { $set: { lastDailyReset: new Date() } } },
];
const resetDailyCounters = async () => {
    console.info("[daily-reset] connecting to mongo...");
    await mongoose_1.default.connect(mongoUri, { autoIndex: false });
    const db = mongoose_1.default.connection.db;
    if (!db) {
        console.error("[daily-reset] MongoDB connection is not ready, aborting.");
        await mongoose_1.default.disconnect();
        return;
    }
    for (const t of tasks) {
        try {
            const exists = await ensureCollectionExists(db, t.name);
            if (!exists) {
                console.info(`[daily-reset] collection ${t.name} not found; skipping.`);
                continue;
            }
            const res = await db.collection(t.name).updateMany({}, t.update);
            console.info(`[daily-reset] collection=${t.name} matched=${res.matchedCount} modified=${res.modifiedCount}`);
        }
        catch (err) {
            console.error(`[daily-reset] failed updating ${t.name}:`, err instanceof Error ? err.message : String(err));
        }
    }
    await mongoose_1.default.disconnect();
    console.info("[daily-reset] done");
};
exports.resetDailyCounters = resetDailyCounters;
if (require.main === module) {
    (0, exports.resetDailyCounters)().catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
//# sourceMappingURL=daily-reset.js.map