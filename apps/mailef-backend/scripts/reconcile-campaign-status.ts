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

const getObjectId = (id: string): mongoose.Types.ObjectId => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`Invalid campaignId: ${id}`);
  }
  return new mongoose.Types.ObjectId(id);
};

type CampaignRow = {
  _id: mongoose.Types.ObjectId;
  status?: string;
  sentAt?: Date | null;
};

type CountRow = { _id: string; n: number };

const getCount = (rows: CountRow[], key: string): number => {
  const row = rows.find((item) => item._id === key);
  return row ? row.n : 0;
};

const reconcileCampaign = async (campaign: CampaignRow) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is not ready");

  const recipients = db.collection("campaignrecipients");
  const campaigns = db.collection("campaigns");

  const [counts, lastSentRecipient] = await Promise.all([
    recipients
      .aggregate([
        { $match: { campaignId: campaign._id } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ])
      .toArray() as Promise<CountRow[]>,
    recipients
      .find({ campaignId: campaign._id, status: "sent", sentAt: { $ne: null } })
      .sort({ sentAt: -1 })
      .limit(1)
      .project({ sentAt: 1 })
      .next(),
  ]);

  const pending = getCount(counts, "pending");
  const queued = getCount(counts, "queued");
  const sent = getCount(counts, "sent");
  const failed = getCount(counts, "failed");
  const backlog = pending + queued;

  const output = {
    campaignId: campaign._id.toString(),
    status: campaign.status || null,
    counts: { pending, queued, sent, failed },
    action: "none" as "none" | "finalized",
  };

  if (backlog === 0 && sent + failed > 0) {
    await campaigns.updateOne(
      { _id: campaign._id },
      {
        $set: {
          status: "sent",
          pauseReason: null,
          sentAt: campaign.sentAt || lastSentRecipient?.sentAt || new Date(),
          updatedAt: new Date(),
        },
      }
    );

    output.action = "finalized";
  }

  return output;
};

const run = async () => {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is not ready");

  const campaignsCollection = db.collection("campaigns");

  const query = campaignId
    ? { _id: getObjectId(campaignId), status: "sending" }
    : { status: "sending" };

  const campaigns = (await campaignsCollection
    .find(query)
    .project({ _id: 1, status: 1, sentAt: 1 })
    .toArray()) as CampaignRow[];

  if (campaigns.length === 0) {
    console.log(
      JSON.stringify({
        scanned: 0,
        finalized: 0,
        message: campaignId
          ? "No matching sending campaign found for the provided id"
          : "No sending campaigns found",
      })
    );
    await mongoose.disconnect();
    return;
  }

  let finalized = 0;
  const details = [] as Array<Awaited<ReturnType<typeof reconcileCampaign>>>;

  for (const campaign of campaigns) {
    const result = await reconcileCampaign(campaign);
    if (result.action === "finalized") finalized += 1;
    details.push(result);
  }

  console.log(
    JSON.stringify({
      scanned: campaigns.length,
      finalized,
      details,
    })
  );

  await mongoose.disconnect();
};

void run().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors on failure path
  }
  process.exit(1);
});
