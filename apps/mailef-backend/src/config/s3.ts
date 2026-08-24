import { S3Client } from "@aws-sdk/client-s3";
import "./env";

export const s3Region = process.env.AWS_REGION || "us-east-1";
export const s3ListBucket = process.env.S3_LIST_BUCKET?.trim() || "";

export const s3Client = new S3Client({
  region: s3Region,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN,
        }
      : undefined,
});

export const assertS3ListBucketConfigured = (): void => {
  if (!s3ListBucket) {
    throw new Error("S3_LIST_BUCKET is not configured");
  }
};
