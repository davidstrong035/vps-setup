import { Response } from "express";
import mongoose from "mongoose";
import Subscriber from "../models/Subscriber.model";
import List from "../models/List.model";
import ListSuppression from "../models/ListSuppression.model";
import { getActiveEmailAllocation } from "../services/email-allocation.service";
import { AuthRequest } from "../types";
import { logger } from "../utils/logger";
import {
  getListUploadUrl,
  processUploadedListObject,
} from "../services/s3-list.service";
import { validateEmailSyntax, isDisposableDomain } from "../services/email-validation.service";

const IMPORT_CHUNK_SIZE = Math.max(Number(process.env.SUBSCRIBER_IMPORT_CHUNK_SIZE) || 500, 100);

export const getSubscribers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { listId } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;

    const list = await List.findOne({ _id: listId, userId: req.userId });
    if (!list) {
      res.status(404).json({ message: "List not found" });
      return;
    }

    if (list.storageType === "s3") {
      const previewRows = list.previewRows || [];
      res.json({
        subscribers: previewRows.slice(0, limit).map((row, index) => ({
          _id: `${listId}:preview:${index}`,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          status: "active",
          createdAt: list.updatedAt,
        })),
        total: list.subscriberCount || 0,
        page: 1,
        pages: 1,
      });
      return;
    }

    const [subscribers, total] = await Promise.all([
      Subscriber.find({ listId }).skip((page - 1) * limit).limit(limit),
      Subscriber.countDocuments({ listId }),
    ]);

    res.json({ subscribers, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: "Failed to get subscribers", error });
  }
};

export const addSubscriber = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { listId } = req.params;
    const { email, firstName, lastName, customFields } = req.body;

    const list = await List.findOne({ _id: listId, userId: req.userId });
    if (!list) {
      res.status(404).json({ message: "List not found" });
      return;
    }

    if (list.storageType === "s3") {
      res.status(400).json({
        message: "Manual subscriber add is disabled for S3-managed lists. Re-upload the list file instead.",
      });
      return;
    }

    // Validate email syntax
    const validation = validateEmailSyntax(email);
    if (!validation.valid) {
      res.status(400).json({ message: `Invalid email: ${validation.reason}` });
      return;
    }

    const domain = validation.canonicalEmail.split("@")[1];
    if (domain && isDisposableDomain(domain)) {
      res.status(400).json({ message: "Disposable/temporary email addresses are not allowed" });
      return;
    }

    const allocation = await getActiveEmailAllocation(req.userId!);
    const remainingCredits = allocation
      ? Math.max(allocation.emailsPurchased - allocation.consumedEmails - allocation.reservedEmails, 0)
      : 0;
    if (remainingCredits <= 0) {
      res.status(403).json({
        message: allocation
          ? "Your email package has no remaining send credits. Contact admin to top up."
          : "You do not have an active email package. Contact admin after payment confirmation.",
      });
      return;
    }

    const subscriber = await Subscriber.create({
      userId: req.userId,
      listId: new mongoose.Types.ObjectId(listId as string),
      email: validation.canonicalEmail,
      firstName,
      lastName,
      customFields,
    });

    await List.findByIdAndUpdate(listId, { $inc: { subscriberCount: 1 } });

    res.status(201).json({ subscriber });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).json({ message: "Email already in this list" });
      return;
    }
    res.status(500).json({ message: "Failed to add subscriber", error });
  }
};

export const initiateS3SubscriberImport = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { listId } = req.params;
    const { fileName, contentType } = req.body as {
      fileName?: string;
      contentType?: string;
    };

    const list = await List.findOne({ _id: listId, userId: req.userId });
    if (!list) {
      res.status(404).json({ message: "List not found" });
      return;
    }

    if (!fileName) {
      res.status(400).json({ message: "fileName is required" });
      return;
    }

    const { uploadUrl, objectKey } = await getListUploadUrl(
      req.userId!,
      String(list._id),
      fileName,
      contentType || "text/plain"
    );

    await List.findByIdAndUpdate(list._id, {
      $set: {
        importStatus: "processing",
        storageType: "s3",
        sourceOriginalFileName: fileName,
        s3UploadKey: objectKey,
      },
    });

    res.json({ uploadUrl, objectKey });
  } catch (error) {
    logger.error("Failed to initiate S3 subscriber import", {
      listId: req.params.listId,
      userId: req.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: "Failed to initiate subscriber upload" });
  }
};

export const completeS3SubscriberImport = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { listId } = req.params;
    const { objectKey } = req.body as { objectKey?: string };

    const list = await List.findOne({ _id: listId, userId: req.userId });
    if (!list) {
      res.status(404).json({ message: "List not found" });
      return;
    }

    if (!objectKey || objectKey !== list.s3UploadKey) {
      res.status(400).json({ message: "Invalid upload key" });
      return;
    }

    const result = await processUploadedListObject(req.userId!, String(list._id), objectKey);

    await Subscriber.deleteMany({ listId: list._id });

    const updated = await List.findByIdAndUpdate(
      list._id,
      {
        $set: {
          storageType: "s3",
          importStatus: "ready",
          subscriberCount: result.subscriberCount,
          s3ManifestKey: result.manifestKey,
          s3ChunkCount: result.chunkCount,
          previewRows: result.previewRows,
        },
      },
      { returnDocument: "after" }
    );

    res.json({
      message: `Uploaded and indexed ${result.subscriberCount.toLocaleString()} subscribers to S3.`,
      list: updated,
    });
  } catch (error) {
    await List.findByIdAndUpdate(req.params.listId, {
      $set: { importStatus: "failed" },
    }).catch(() => null);

    logger.error("Failed to complete S3 subscriber import", {
      listId: req.params.listId,
      userId: req.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: "Failed to process uploaded subscriber file" });
  }
};

export const importSubscribers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { listId } = req.params;
    const { subscribers } = req.body as {
      subscribers: Array<{ email: string; firstName?: string; lastName?: string }>;
    };

    if (!Array.isArray(subscribers) || subscribers.length === 0) {
      res.status(400).json({ message: "subscribers must be a non-empty array" });
      return;
    }

    const list = await List.findOne({ _id: listId, userId: req.userId });
    if (!list) {
      res.status(404).json({ message: "List not found" });
      return;
    }

    const allocation = await getActiveEmailAllocation(req.userId!);
    const remainingCredits = allocation
      ? Math.max(allocation.emailsPurchased - allocation.consumedEmails - allocation.reservedEmails, 0)
      : 0;
    if (!allocation) {
      res.status(403).json({
        message: "You do not have an active email package. Contact admin after payment confirmation.",
      });
      return;
    }
    const normalized = subscribers
      .map((s) => ({
        email: String(s.email || "").trim().toLowerCase(),
        firstName: String(s.firstName || "").trim(),
        lastName: String(s.lastName || "").trim(),
      }))
      .filter((s) => s.email.includes("@"));

    // Validate email syntax + disposable domain check for each subscriber
    const validatedEmails = new Set<string>();
    const validSubscribers: Array<{ email: string; firstName?: string; lastName?: string }> = [];
    let syntaxSkipped = 0;

    for (const item of normalized) {
      const validation = validateEmailSyntax(item.email);
      if (!validation.valid) {
        syntaxSkipped++;
        continue;
      }

      // Check disposable domain at import time
      const domain = validation.canonicalEmail.split("@")[1];
      if (domain && isDisposableDomain(domain)) {
        syntaxSkipped++;
        continue;
      }

      if (!validatedEmails.has(validation.canonicalEmail)) {
        validatedEmails.add(validation.canonicalEmail);
        validSubscribers.push({
          email: validation.canonicalEmail,
          firstName: item.firstName,
          lastName: item.lastName,
        });
      }
    }

    const uniqueSubscribers = validSubscribers;
    const skippedInvalidOrDuplicateInPayload = subscribers.length - uniqueSubscribers.length;

    if (uniqueSubscribers.length === 0) {
      res.status(400).json({ message: "No valid unique emails found in import payload." });
      return;
    }

    if (uniqueSubscribers.length > remainingCredits) {
      res.status(403).json({
        message: `Import of ${uniqueSubscribers.length} subscribers exceeds your remaining send credits (${remainingCredits}). Reduce the list or top up your package.`,
        remainingCredits,
        attempting: uniqueSubscribers.length,
      });
      return;
    }

    const docs = uniqueSubscribers.map((s) => ({
      userId: req.userId,
      listId,
      email: s.email,
      firstName: s.firstName,
      lastName: s.lastName,
    }));

    let insertedTotal = 0;
    let duplicateConflicts = 0;

    for (let index = 0; index < docs.length; index += IMPORT_CHUNK_SIZE) {
      const chunk = docs.slice(index, index + IMPORT_CHUNK_SIZE);

      try {
        const insertedDocs = await Subscriber.insertMany(chunk, { ordered: false });
        insertedTotal += insertedDocs.length;
      } catch (error: any) {
        const writeErrors: Array<{ code?: number }> = Array.isArray(error?.writeErrors)
          ? error.writeErrors
          : [];

        const duplicateInChunk = writeErrors.filter((item) => item.code === 11000).length;
        duplicateConflicts += duplicateInChunk;

        const insertedInChunk =
          Number(error?.result?.insertedCount) ||
          Number(error?.result?.nInserted) ||
          0;
        insertedTotal += insertedInChunk;

        const hasNonDuplicateError = writeErrors.some((item) => item.code !== 11000);
        if (hasNonDuplicateError || writeErrors.length === 0) {
          throw error;
        }
      }
    }

    if (insertedTotal > 0) {
      await List.findByIdAndUpdate(listId, { $inc: { subscriberCount: insertedTotal } });
    }

    const skipped = skippedInvalidOrDuplicateInPayload + duplicateConflicts;
    if (skipped > 0) {
      res.json({
        message: `Imported ${insertedTotal} subscribers (${skipped} skipped due to invalid or duplicate emails).`,
        inserted: insertedTotal,
        skipped,
      });
      return;
    }

    res.json({ message: `Imported ${insertedTotal} subscribers`, inserted: insertedTotal });
  } catch (error: any) {
    logger.error("Failed to import subscribers", {
      listId: req.params.listId,
      userId: req.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      message:
        "Failed to import subscribers due to a server processing error. Please retry with a smaller file or contact support.",
    });
  }
};

export const deleteSubscriber = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subscriber = await Subscriber.findOneAndDelete({
      _id: req.params.subscriberId,
      userId: req.userId,
    });
    if (!subscriber) {
      res.status(404).json({ message: "Subscriber not found" });
      return;
    }
    await List.findByIdAndUpdate(subscriber.listId, { $inc: { subscriberCount: -1 } });
    res.json({ message: "Subscriber deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete subscriber", error });
  }
};

// public unsubscribe (no auth needed)
export const unsubscribe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, listId } = req.query as { email: string; listId: string };
    const normalizedEmail = String(email || "").trim().toLowerCase();
    await Subscriber.findOneAndUpdate(
      { email: normalizedEmail, listId },
      { $set: { status: "unsubscribed" } }
    );

    const list = await List.findById(listId).select("userId").lean();
    if (list?.userId) {
      await ListSuppression.findOneAndUpdate(
        { listId, email: normalizedEmail },
        {
          $set: {
            userId: list.userId,
            listId,
            email: normalizedEmail,
            status: "unsubscribed",
            source: "unsubscribe",
          },
        },
        { upsert: true, returnDocument: "after" }
      );
    }

    res.send("<h2>You have been unsubscribed successfully.</h2>");
  } catch (error) {
    res.status(500).send("Unsubscribe failed");
  }
};
