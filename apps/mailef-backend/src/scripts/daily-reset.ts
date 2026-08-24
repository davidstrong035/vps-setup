import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const mongoUri =
  process.env.MONGODB_URI_PROD || process.env.MONGODB_URI || process.env.MONGODB_URI_DEV;

if (!mongoUri) {
  console.error("Missing MongoDB URI. Set MONGODB_URI_PROD, MONGODB_URI or MONGODB_URI_DEV.");
  process.exit(1);
}

const ensureCollectionExists = async (db: any, name: string) => {
  const list = await db.listCollections({ name }).toArray();
  return list.length > 0;
};

const tasks: { name: string; update: any }[] = [
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

export const resetDailyCounters = async (): Promise<void> => {
  console.info("[daily-reset] connecting to mongo...");
  await mongoose.connect(mongoUri, { autoIndex: false });

  const db = mongoose.connection.db;
  if (!db) {
    console.error("[daily-reset] MongoDB connection is not ready, aborting.");
    await mongoose.disconnect();
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
      console.info(
        `[daily-reset] collection=${t.name} matched=${res.matchedCount} modified=${res.modifiedCount}`,
      );
    } catch (err) {
      console.error(
        `[daily-reset] failed updating ${t.name}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await mongoose.disconnect();
  console.info("[daily-reset] done");
};

if (require.main === module) {
  resetDailyCounters().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
