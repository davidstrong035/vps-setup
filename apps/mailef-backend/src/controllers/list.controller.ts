import { Response } from "express";
import List from "../models/List.model";
import ListSuppression from "../models/ListSuppression.model";
import Subscriber from "../models/Subscriber.model";
import { deleteListObjects } from "../services/s3-list.service";
import { AuthRequest } from "../types";

export const getLists = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lists = await List.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ lists });
  } catch (error) {
    res.status(500).json({ message: "Failed to get lists", error });
  }
};

export const createList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ message: "List name is required" });
      return;
    }
    const list = await List.create({ userId: req.userId, name, description });
    res.status(201).json({ list });
  } catch (error) {
    res.status(500).json({ message: "Failed to create list", error });
  }
};

export const getList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await List.findOne({ _id: req.params.id, userId: req.userId });
    if (!list) {
      res.status(404).json({ message: "List not found" });
      return;
    }
    res.json({ list });
  } catch (error) {
    res.status(500).json({ message: "Failed to get list", error });
  }
};

export const updateList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await List.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: req.body },
      { returnDocument: "after" }
    );
    if (!list) {
      res.status(404).json({ message: "List not found" });
      return;
    }
    res.json({ list });
  } catch (error) {
    res.status(500).json({ message: "Failed to update list", error });
  }
};

export const deleteList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await List.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!list) {
      res.status(404).json({ message: "List not found" });
      return;
    }

    // clean up all related data in parallel
    await Promise.all([
      // S3 objects (manifest, chunks, raw upload) — fire-and-forget errors
      list.storageType === "s3"
        ? deleteListObjects(req.userId!, String(list._id), {
            s3UploadKey: list.s3UploadKey,
            s3ManifestKey: list.s3ManifestKey,
            s3ChunkCount: list.s3ChunkCount,
          }).catch(() => null)
        : Promise.resolve(),

      // Mongo subscribers (mongo-backed lists)
      Subscriber.deleteMany({ listId: list._id }),

      // Suppression records
      ListSuppression.deleteMany({ listId: list._id }),
    ]);

    res.json({ message: "List deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete list", error });
  }
};
