"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertS3ListBucketConfigured = exports.s3Client = exports.s3ListBucket = exports.s3Region = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
require("./env");
exports.s3Region = process.env.AWS_REGION || "us-east-1";
exports.s3ListBucket = process.env.S3_LIST_BUCKET?.trim() || "";
exports.s3Client = new client_s3_1.S3Client({
    region: exports.s3Region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN,
        }
        : undefined,
});
const assertS3ListBucketConfigured = () => {
    if (!exports.s3ListBucket) {
        throw new Error("S3_LIST_BUCKET is not configured");
    }
};
exports.assertS3ListBucketConfigured = assertS3ListBucketConfigured;
//# sourceMappingURL=s3.js.map