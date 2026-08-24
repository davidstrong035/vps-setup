import { Response } from "express";
import Template from "../models/Template.model";
import { AuthRequest } from "../types";

export const getTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const templates = await Template.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ templates });
  } catch (error) {
    res.status(500).json({ message: "Failed to get templates", error });
  }
};

export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, subject, html } = req.body;
    if (!name || !subject || !html) {
      res.status(400).json({ message: "name, subject and html are required" });
      return;
    }
    const template = await Template.create({ userId: req.userId, name, subject, html });
    res.status(201).json({ template });
  } catch (error) {
    res.status(500).json({ message: "Failed to create template", error });
  }
};

export const getTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const template = await Template.findOne({ _id: req.params.id, userId: req.userId });
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json({ template });
  } catch (error) {
    res.status(500).json({ message: "Failed to get template", error });
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const template = await Template.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: req.body },
      { returnDocument: "after" }
    );
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json({ template });
  } catch (error) {
    res.status(500).json({ message: "Failed to update template", error });
  }
};

export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const template = await Template.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json({ message: "Template deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete template", error });
  }
};
