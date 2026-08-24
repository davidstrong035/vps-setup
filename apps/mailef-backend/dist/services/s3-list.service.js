"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChunkRows = exports.deleteListObjects = exports.getListManifest = exports.processUploadedListObject = exports.getListUploadUrl = exports.getMaxUploadFileSize = exports.buildListUploadKey = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const node_stream_1 = require("node:stream");
const node_readline_1 = __importDefault(require("node:readline"));
const s3_1 = require("../config/s3");
const email_validation_service_1 = require("./email-validation.service");
const LIST_CHUNK_SIZE = Math.max(Number(process.env.S3_LIST_CHUNK_SIZE) || 5000, 100);
const LIST_PREVIEW_SIZE = Math.max(Number(process.env.S3_LIST_PREVIEW_SIZE) || 100, 10);
const PRESIGNED_URL_EXPIRES_SECONDS = Math.max(Number(process.env.S3_LIST_UPLOAD_URL_EXPIRES_SECONDS) || 900, 60);
/** Maximum file size for S3 list uploads (default: 50MB, minimum: 1MB). */
const MAX_UPLOAD_FILE_SIZE_BYTES = Math.max(Number(process.env.S3_LIST_MAX_UPLOAD_SIZE_BYTES) || 52428800, 1048576);
const parseRow = (line) => {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    const [emailRaw, firstNameRaw = "", lastNameRaw = ""] = trimmed
        .split(",")
        .map((value) => value.trim());
    if (emailRaw.toLowerCase() === "email") {
        return null;
    }
    const validation = (0, email_validation_service_1.validateEmailSyntax)(emailRaw);
    if (!validation.valid) {
        return null;
    }
    const domain = validation.canonicalEmail.split("@")[1];
    if (domain && (0, email_validation_service_1.isDisposableDomain)(domain)) {
        return null;
    }
    return {
        email: validation.canonicalEmail,
        firstName: firstNameRaw || undefined,
        lastName: lastNameRaw || undefined,
    };
};
const bodyToReadable = (body) => {
    if (!body) {
        throw new Error("S3 object body is empty");
    }
    if (body instanceof node_stream_1.Readable) {
        return body;
    }
    const maybeReadable = body;
    if (typeof maybeReadable.pipe === "function") {
        return maybeReadable;
    }
    throw new Error("Unsupported S3 object body type");
};
const buildListUploadKey = (userId, listId, fileName) => {
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
    return `lists/${userId}/${listId}/uploads/${Date.now()}-${safeFileName}`;
};
exports.buildListUploadKey = buildListUploadKey;
const getMaxUploadFileSize = () => MAX_UPLOAD_FILE_SIZE_BYTES;
exports.getMaxUploadFileSize = getMaxUploadFileSize;
const getListUploadUrl = async (userId, listId, fileName, contentType) => {
    (0, s3_1.assertS3ListBucketConfigured)();
    const objectKey = (0, exports.buildListUploadKey)(userId, listId, fileName);
    const command = new client_s3_1.PutObjectCommand({
        Bucket: s3_1.s3ListBucket,
        Key: objectKey,
        ContentType: contentType || "text/plain",
    });
    const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3_1.s3Client, command, {
        expiresIn: PRESIGNED_URL_EXPIRES_SECONDS,
    });
    return { uploadUrl, objectKey, maxFileSize: MAX_UPLOAD_FILE_SIZE_BYTES };
};
exports.getListUploadUrl = getListUploadUrl;
const processUploadedListObject = async (userId, listId, objectKey) => {
    (0, s3_1.assertS3ListBucketConfigured)();
    const response = await s3_1.s3Client.send(new client_s3_1.GetObjectCommand({
        Bucket: s3_1.s3ListBucket,
        Key: objectKey,
    }));
    const stream = bodyToReadable(response.Body);
    const lineReader = node_readline_1.default.createInterface({ input: stream, crlfDelay: Infinity });
    const seenEmails = new Set();
    const chunkKeys = [];
    const previewRows = [];
    let currentChunk = [];
    let totalSubscribers = 0;
    let chunkIndex = 0;
    const flushChunk = async () => {
        if (currentChunk.length === 0)
            return;
        const chunkKey = `lists/${userId}/${listId}/chunks/${chunkIndex}.jsonl`;
        const body = currentChunk.map((row) => JSON.stringify(row)).join("\n");
        await s3_1.s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: s3_1.s3ListBucket,
            Key: chunkKey,
            Body: body,
            ContentType: "application/x-ndjson",
        }));
        chunkKeys.push(chunkKey);
        chunkIndex += 1;
        currentChunk = [];
    };
    for await (const line of lineReader) {
        const parsed = parseRow(line);
        if (!parsed)
            continue;
        if (seenEmails.has(parsed.email))
            continue;
        seenEmails.add(parsed.email);
        totalSubscribers += 1;
        if (previewRows.length < LIST_PREVIEW_SIZE) {
            previewRows.push(parsed);
        }
        currentChunk.push(parsed);
        if (currentChunk.length >= LIST_CHUNK_SIZE) {
            await flushChunk();
        }
    }
    await flushChunk();
    const manifestKey = `lists/${userId}/${listId}/manifest.json`;
    const manifest = {
        version: 1,
        chunkKeys,
        totalSubscribers,
        generatedAt: new Date().toISOString(),
    };
    await s3_1.s3Client.send(new client_s3_1.PutObjectCommand({
        Bucket: s3_1.s3ListBucket,
        Key: manifestKey,
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
    }));
    return {
        subscriberCount: totalSubscribers,
        chunkCount: chunkKeys.length,
        manifestKey,
        previewRows,
    };
};
exports.processUploadedListObject = processUploadedListObject;
const getListManifest = async (manifestKey) => {
    (0, s3_1.assertS3ListBucketConfigured)();
    const response = await s3_1.s3Client.send(new client_s3_1.GetObjectCommand({
        Bucket: s3_1.s3ListBucket,
        Key: manifestKey,
    }));
    const stream = bodyToReadable(response.Body);
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { chunkKeys: parsed.chunkKeys || [] };
};
exports.getListManifest = getListManifest;
const deleteListObjects = async (userId, listId, opts) => {
    (0, s3_1.assertS3ListBucketConfigured)();
    const keysToDelete = [];
    // collect chunk keys from manifest if available
    if (opts.s3ManifestKey) {
        try {
            const manifest = await (0, exports.getListManifest)(opts.s3ManifestKey);
            keysToDelete.push(...manifest.chunkKeys);
        }
        catch {
            // manifest may already be gone — fall back to raw chunk prefix scan
            const chunkCount = opts.s3ChunkCount || 0;
            for (let i = 0; i < chunkCount; i++) {
                keysToDelete.push(`lists/${userId}/${listId}/chunks/${i}.jsonl`);
            }
        }
        keysToDelete.push(opts.s3ManifestKey);
    }
    if (opts.s3UploadKey) {
        keysToDelete.push(opts.s3UploadKey);
    }
    if (keysToDelete.length === 0)
        return;
    // S3 DeleteObjects accepts up to 1000 keys per call
    const BATCH = 1000;
    for (let i = 0; i < keysToDelete.length; i += BATCH) {
        const batch = keysToDelete.slice(i, i + BATCH);
        await s3_1.s3Client.send(new client_s3_1.DeleteObjectsCommand({
            Bucket: s3_1.s3ListBucket,
            Delete: {
                Objects: batch.map((Key) => ({ Key })),
                Quiet: true,
            },
        }));
    }
};
exports.deleteListObjects = deleteListObjects;
const getChunkRows = async (chunkKey) => {
    (0, s3_1.assertS3ListBucketConfigured)();
    const response = await s3_1.s3Client.send(new client_s3_1.GetObjectCommand({
        Bucket: s3_1.s3ListBucket,
        Key: chunkKey,
    }));
    const stream = bodyToReadable(response.Body);
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const payload = Buffer.concat(chunks).toString("utf8");
    return payload
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
};
exports.getChunkRows = getChunkRows;
//# sourceMappingURL=s3-list.service.js.map