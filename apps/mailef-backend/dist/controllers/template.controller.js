"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTemplate = exports.updateTemplate = exports.getTemplate = exports.createTemplate = exports.getTemplates = void 0;
const Template_model_1 = __importDefault(require("../models/Template.model"));
const getTemplates = async (req, res) => {
    try {
        const templates = await Template_model_1.default.find({ userId: req.userId }).sort({ createdAt: -1 });
        res.json({ templates });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get templates", error });
    }
};
exports.getTemplates = getTemplates;
const createTemplate = async (req, res) => {
    try {
        const { name, subject, html } = req.body;
        if (!name || !subject || !html) {
            res.status(400).json({ message: "name, subject and html are required" });
            return;
        }
        const template = await Template_model_1.default.create({ userId: req.userId, name, subject, html });
        res.status(201).json({ template });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to create template", error });
    }
};
exports.createTemplate = createTemplate;
const getTemplate = async (req, res) => {
    try {
        const template = await Template_model_1.default.findOne({ _id: req.params.id, userId: req.userId });
        if (!template) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        res.json({ template });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to get template", error });
    }
};
exports.getTemplate = getTemplate;
const updateTemplate = async (req, res) => {
    try {
        const template = await Template_model_1.default.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { $set: req.body }, { returnDocument: "after" });
        if (!template) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        res.json({ template });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update template", error });
    }
};
exports.updateTemplate = updateTemplate;
const deleteTemplate = async (req, res) => {
    try {
        const template = await Template_model_1.default.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        if (!template) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        res.json({ message: "Template deleted" });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to delete template", error });
    }
};
exports.deleteTemplate = deleteTemplate;
//# sourceMappingURL=template.controller.js.map