import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import readline from "node:readline";
import { assertS3ListBucketConfigured, s3Client, s3ListBucket } from "../config/s3";
import { validateEmailSyntax, isDisposableDomain } from "./email-validation.service";

const LIST_CHUNK_SIZE = Math.max(Number(process.env.S3_LIST_CHUNK_SIZE) || 5000, 100);
const LIST_PREVIEW_SIZE = Math.max(Number(process.env.S3_LIST_PREVIEW_SIZE) || 100, 10);
const PRESIGNED_URL_EXPIRES_SECONDS = Math.max(
  Number(process.env.S3_LIST_UPLOAD_URL_EXPIRES_SECONDS) || 900,
  60
);
/** Maximum file size for S3 list uploads (default: 50MB, minimum: 1MB). */
const MAX_UPLOAD_FILE_SIZE_BYTES = Math.max(
  Number(process.env.S3_LIST_MAX_UPLOAD_SIZE_BYTES) || 52_428_800,
  1_048_576
);

export interface ParsedListRow {
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface ProcessedS3ListResult {
  subscriberCount: number;
  chunkCount: number;
  manifestKey: string;
  previewRows: ParsedListRow[];
}

interface ListManifest {
  version: 1;
  chunkKeys: string[];
  totalSubscribers: number;
  generatedAt: string;
}

const parseRow = (line: string): ParsedListRow | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const [emailRaw, firstNameRaw = "", lastNameRaw = ""] = trimmed
    .split(",")
    .map((value) => value.trim());

  if (emailRaw.toLowerCase() === "email") {
    return null;
  }

  const validation = validateEmailSyntax(emailRaw);
  if (!validation.valid) {
    return null;
  }

  const domain = validation.canonicalEmail.split("@")[1];
  if (domain && isDisposableDomain(domain)) {
    return null;
  }

  return {
    email: validation.canonicalEmail,
    firstName: firstNameRaw || undefined,
    lastName: lastNameRaw || undefined,
  };
};

const bodyToReadable = (body: unknown): Readable => {
  if (!body) {
    throw new Error("S3 object body is empty");
  }

  if (body instanceof Readable) {
    return body;
  }

  const maybeReadable = body as Readable & { transformToWebStream?: () => ReadableStream };
  if (typeof maybeReadable.pipe === "function") {
    return maybeReadable;
  }

  throw new Error("Unsupported S3 object body type");
};

export const buildListUploadKey = (userId: string, listId: string, fileName: string): string => {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `lists/${userId}/${listId}/uploads/${Date.now()}-${safeFileName}`;
};

export const getMaxUploadFileSize = (): number => MAX_UPLOAD_FILE_SIZE_BYTES;

export const getListUploadUrl = async (
  userId: string,
  listId: string,
  fileName: string,
  contentType: string
): Promise<{ uploadUrl: string; objectKey: string; maxFileSize: number }> => {
  assertS3ListBucketConfigured();

  const objectKey = buildListUploadKey(userId, listId, fileName);
  const command = new PutObjectCommand({
    Bucket: s3ListBucket,
    Key: objectKey,
    ContentType: contentType || "text/plain",
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRES_SECONDS,
  });

  return { uploadUrl, objectKey, maxFileSize: MAX_UPLOAD_FILE_SIZE_BYTES };
};

export const processUploadedListObject = async (
  userId: string,
  listId: string,
  objectKey: string
): Promise<ProcessedS3ListResult> => {
  assertS3ListBucketConfigured();

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: s3ListBucket,
      Key: objectKey,
    })
  );

  const stream = bodyToReadable(response.Body);
  const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const seenEmails = new Set<string>();
  const chunkKeys: string[] = [];
  const previewRows: ParsedListRow[] = [];
  let currentChunk: ParsedListRow[] = [];
  let totalSubscribers = 0;
  let chunkIndex = 0;

  const flushChunk = async () => {
    if (currentChunk.length === 0) return;

    const chunkKey = `lists/${userId}/${listId}/chunks/${chunkIndex}.jsonl`;
    const body = currentChunk.map((row) => JSON.stringify(row)).join("\n");

    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3ListBucket,
        Key: chunkKey,
        Body: body,
        ContentType: "application/x-ndjson",
      })
    );

    chunkKeys.push(chunkKey);
    chunkIndex += 1;
    currentChunk = [];
  };

  for await (const line of lineReader) {
    const parsed = parseRow(line);
    if (!parsed) continue;
    if (seenEmails.has(parsed.email)) continue;

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
  const manifest: ListManifest = {
    version: 1,
    chunkKeys,
    totalSubscribers,
    generatedAt: new Date().toISOString(),
  };

  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3ListBucket,
      Key: manifestKey,
      Body: JSON.stringify(manifest),
      ContentType: "application/json",
    })
  );

  return {
    subscriberCount: totalSubscribers,
    chunkCount: chunkKeys.length,
    manifestKey,
    previewRows,
  };
};

export const getListManifest = async (manifestKey: string): Promise<{ chunkKeys: string[] }> => {
  assertS3ListBucketConfigured();

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: s3ListBucket,
      Key: manifestKey,
    })
  );

  const stream = bodyToReadable(response.Body);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ListManifest;
  return { chunkKeys: parsed.chunkKeys || [] };
};

export const deleteListObjects = async (
  userId: string,
  listId: string,
  opts: { s3UploadKey?: string; s3ManifestKey?: string; s3ChunkCount?: number }
): Promise<void> => {
  assertS3ListBucketConfigured();

  const keysToDelete: string[] = [];

  // collect chunk keys from manifest if available
  if (opts.s3ManifestKey) {
    try {
      const manifest = await getListManifest(opts.s3ManifestKey);
      keysToDelete.push(...manifest.chunkKeys);
    } catch {
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

  if (keysToDelete.length === 0) return;

  // S3 DeleteObjects accepts up to 1000 keys per call
  const BATCH = 1000;
  for (let i = 0; i < keysToDelete.length; i += BATCH) {
    const batch = keysToDelete.slice(i, i + BATCH);
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: s3ListBucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
  }
};

export const getChunkRows = async (chunkKey: string): Promise<ParsedListRow[]> => {
  assertS3ListBucketConfigured();

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: s3ListBucket,
      Key: chunkKey,
    })
  );

  const stream = bodyToReadable(response.Body);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const payload = Buffer.concat(chunks).toString("utf8");
  return payload
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ParsedListRow);
};
