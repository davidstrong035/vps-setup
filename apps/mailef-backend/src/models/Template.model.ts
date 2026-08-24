import mongoose, { Schema } from "mongoose";
import { ITemplate } from "../types";

const TemplateSchema = new Schema<ITemplate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    html: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ITemplate>("Template", TemplateSchema);
