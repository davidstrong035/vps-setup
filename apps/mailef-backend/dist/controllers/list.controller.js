"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteList = exports.updateList = exports.getList = exports.createList = exports.getLists = void 0;
const List_model_1 = __importDefault(require("../models/List.model"));
const ListSuppression_model_1 = __importDefault(require("../models/ListSuppression.model"));
const Subscriber_model_1 = __importDefault(require("../models/Subscriber.model"));
const s3_list_service_1 = require("../services/s3-list.service");
const getLists = async (req, res) => {
    try {
        const lists = await List_model_1.default.find({ userId: req.userId }).sort({ createdAt: -1 });
        res.json({ lists });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get lists", error });
    }
};
exports.getLists = getLists;
const createList = async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) {
            res.status(400).json({ message: "List name is required" });
            return;
        }
        const list = await List_model_1.default.create({ userId: req.userId, name, description });
        res.status(201).json({ list });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to create list", error });
    }
};
exports.createList = createList;
const getList = async (req, res) => {
    try {
        const list = await List_model_1.default.findOne({ _id: req.params.id, userId: req.userId });
        if (!list) {
            res.status(404).json({ message: "List not found" });
            return;
        }
        res.json({ list });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get list", error });
    }
};
exports.getList = getList;
const updateList = async (req, res) => {
    try {
        const list = await List_model_1.default.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { $set: req.body }, { returnDocument: "after" });
        if (!list) {
            res.status(404).json({ message: "List not found" });
            return;
        }
        res.json({ list });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update list", error });
    }
};
exports.updateList = updateList;
const deleteList = async (req, res) => {
    try {
        const list = await List_model_1.default.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        if (!list) {
            res.status(404).json({ message: "List not found" });
            return;
        }
        // clean up all related data in parallel
        await Promise.all([
            // S3 objects (manifest, chunks, raw upload) — fire-and-forget errors
            list.storageType === "s3"
                ? (0, s3_list_service_1.deleteListObjects)(req.userId, String(list._id), {
                    s3UploadKey: list.s3UploadKey,
                    s3ManifestKey: list.s3ManifestKey,
                    s3ChunkCount: list.s3ChunkCount,
                }).catch(() => null)
                : Promise.resolve(),
            // Mongo subscribers (mongo-backed lists)
            Subscriber_model_1.default.deleteMany({ listId: list._id }),
            // Suppression records
            ListSuppression_model_1.default.deleteMany({ listId: list._id }),
        ]);
        res.json({ message: "List deleted" });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to delete list", error });
    }
};
exports.deleteList = deleteList;
//# sourceMappingURL=list.controller.js.map