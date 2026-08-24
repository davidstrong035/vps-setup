import "../config/env";
import mongoose from "mongoose";
import SmtpRelay from "../models/SmtpRelay.model";

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI_PROD!);

  const result = await SmtpRelay.updateMany(
    { isArchived: { $ne: true } },
    {
      $set: {
        consecutiveFailures: 0,
        healthStatus: "unknown",
        isActive: true,
      },
    }
  );

  console.log(`Reset ${result.modifiedCount} relay(s)`);
  await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
