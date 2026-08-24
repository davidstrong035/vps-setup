import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const mongoUri =
  process.env.MONGODB_URI_PROD || process.env.MONGODB_URI || process.env.MONGODB_URI_DEV;

if (!mongoUri) {
  console.error("Missing MongoDB URI. Set MONGODB_URI_PROD, MONGODB_URI, or MONGODB_URI_DEV.");
  process.exit(1);
}

const campaignId = process.argv[2];
const intervalSeconds = Number(process.argv[3] || 10);

if (!campaignId) {
  console.error("Usage: npx ts-node scripts/monitor-campaign.ts <campaignId> [intervalSeconds]");
  process.exit(1);
}

if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
  console.error("intervalSeconds must be a positive number.");
  process.exit(1);
}

type StatusCount = { _id: string; n: number };

type Snapshot = {
  at: string;
  status: string | null;
  pauseReason: string | null;
  updatedAt: Date | null;
  stats: Record<string, unknown> | null;
  counts: StatusCount[];
};

let previousSent = 0;
let previousFailed = 0;

const readSnapshot = async (): Promise<Snapshot> => {
  const { ObjectId } = mongoose.Types;
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const campaigns = db.collection("campaigns");
  const recipients = db.collection("campaignrecipients");

  const c = await campaigns.findOne(
    { _id: new ObjectId(campaignId) },
    {
      projection: {
        status: 1,
        pauseReason: 1,
        updatedAt: 1,
        "stats.sent": 1,
        "stats.failed": 1,
        "stats.queued": 1,
      },
    }
  );

  if (!c) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const counts = (await recipients
    .aggregate([
      { $match: { campaignId: new ObjectId(campaignId) } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ])
    .toArray()) as StatusCount[];

  return {
    at: new Date().toISOString(),
    status: c.status ?? null,
    pauseReason: c.pauseReason ?? null,
    updatedAt: c.updatedAt ?? null,
    stats: c.stats ?? null,
    counts,
  };
};

const getCount = (counts: StatusCount[], key: string): number => {
  const found = counts.find((x) => x._id === key);
  return found ? found.n : 0;
};

const run = async () => {
  await mongoose.connect(mongoUri);

  const stop = async () => {
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void stop();
  });

  process.on("SIGTERM", () => {
    void stop();
  });

  const tick = async () => {
    try {
      const snap = await readSnapshot();
      const sent = getCount(snap.counts, "sent");
      const failed = getCount(snap.counts, "failed");

      const output = {
        ...snap,
        delta: {
          sent: sent - previousSent,
          failed: failed - previousFailed,
        },
      };

      previousSent = sent;
      previousFailed = failed;

      console.log(JSON.stringify(output));
    } catch (error) {
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, intervalSeconds * 1000);
};

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
