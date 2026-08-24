/**
 * Quick S3 connectivity test.
 * Run with: npx ts-node scripts/test-s3.ts
 */
import "../src/config/env"; // loads .env.development
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const bucket = process.env.S3_LIST_BUCKET || "";
const region = process.env.AWS_REGION || "us-east-1";

if (!bucket) {
  console.error("❌  S3_LIST_BUCKET is not set. Check your .env.development file.");
  process.exit(1);
}

const s3 = new S3Client({
  region,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN,
        }
      : undefined,
});

const testKey = `_test/connectivity-check-${Date.now()}.txt`;
const testBody = "maileff-s3-test-ok";

(async () => {
  console.log(`\nTesting S3 connectivity...`);
  console.log(`  Region : ${region}`);
  console.log(`  Bucket : ${bucket}`);
  console.log(`  Key    : ${testKey}\n`);

  // Write
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: testKey, Body: testBody, ContentType: "text/plain" }));
    console.log("✅  PutObject  — write succeeded");
  } catch (err: any) {
    console.error("❌  PutObject failed:", err.message);
    process.exit(1);
  }

  // Read
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: testKey }));
    const body = await res.Body?.transformToString();
    if (body === testBody) {
      console.log("✅  GetObject  — read succeeded and content matches");
    } else {
      console.warn("⚠️   GetObject  — read succeeded but content mismatch:", body);
    }
  } catch (err: any) {
    console.error("❌  GetObject failed:", err.message);
    process.exit(1);
  }

  // Cleanup
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
    console.log("✅  DeleteObject — cleanup succeeded");
  } catch {
    console.warn("⚠️   Cleanup failed (non-critical)");
  }

  console.log("\n✅  S3 is correctly configured. Ready to use.\n");
})();
