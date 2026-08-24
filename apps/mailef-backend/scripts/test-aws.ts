/**
 * Full AWS connectivity test (STS + SES + S3).
 * Run with: npx ts-node scripts/test-aws.ts
 */
import "../src/config/env";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { SESClient, GetAccountSendingEnabledCommand, GetSendQuotaCommand } from "@aws-sdk/client-ses";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const region = process.env.AWS_REGION || "us-east-1";
const bucket = process.env.S3_LIST_BUCKET || "";

const credentials =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }
    : undefined;

const s3 = new S3Client({ region, credentials });
const ses = new SESClient({ region, credentials });
const sts = new STSClient({ region, credentials });

(async () => {
  console.log("\nAWS connectivity check");
  console.log(`  Region: ${region}`);
  console.log(`  S3 bucket: ${bucket || "(not set)"}`);
  console.log(`  Credential source: ${credentials ? "env access keys" : "default provider chain / IAM role"}\n`);

  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    console.log("✅ STS GetCallerIdentity succeeded");
    console.log(`   Account: ${identity.Account || "unknown"}`);
    console.log(`   ARN    : ${identity.Arn || "unknown"}`);
  } catch (error: any) {
    console.error("❌ STS GetCallerIdentity failed:", error?.message || error);
    process.exit(1);
  }

  try {
    const [sendingEnabled, quota] = await Promise.all([
      ses.send(new GetAccountSendingEnabledCommand({})),
      ses.send(new GetSendQuotaCommand({})),
    ]);

    console.log("✅ SES API check succeeded");
    console.log(`   Sending enabled: ${sendingEnabled.Enabled === true ? "yes" : "no"}`);
    console.log(`   Max24HourSend : ${quota.Max24HourSend ?? "n/a"}`);
    console.log(`   MaxSendRate   : ${quota.MaxSendRate ?? "n/a"}`);
    console.log(`   SentLast24Hours: ${quota.SentLast24Hours ?? "n/a"}`);
  } catch (error: any) {
    console.error("❌ SES check failed:", error?.message || error);
    process.exit(1);
  }

  if (!bucket) {
    console.log("⚠️  S3_LIST_BUCKET not set; skipping S3 check.");
    console.log("\n✅ AWS check complete (STS + SES passed).\n");
    process.exit(0);
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log("✅ S3 HeadBucket succeeded");
  } catch (error: any) {
    console.error("❌ S3 HeadBucket failed:", error?.message || error);
    process.exit(1);
  }

  console.log("\n✅ AWS check complete (STS + SES + S3 passed).\n");
})();
