import mongoose, { Schema } from "mongoose";
import { IList } from "../types";

const ListSchema = new Schema<IList>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    subscriberCount: { type: Number, default: 0 },
    storageType: {
      type: String,
      enum: ["mongo", "s3"],
      default: "mongo",
      index: true,
    },
    importStatus: {
      type: String,
      enum: ["empty", "ready", "processing", "failed"],
      default: "empty",
    },
    sourceOriginalFileName: { type: String, trim: true },
    s3UploadKey: { type: String, trim: true },
    s3ManifestKey: { type: String, trim: true },
    s3ChunkCount: { type: Number, min: 0, default: 0 },
    previewRows: [
      {
        _id: false,
        email: { type: String, required: true, lowercase: true, trim: true },
        firstName: { type: String, trim: true },
        lastName: { type: String, trim: true },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IList>("List", ListSchema);
