import mongoose, { Schema } from "mongoose";
import { IListSuppression } from "../types";

const ListSuppressionSchema = new Schema<IListSuppression>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    listId: { type: Schema.Types.ObjectId, ref: "List", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    status: {
      type: String,
      enum: ["unsubscribed", "bounced", "complained"],
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: [
        "unsubscribe",
        "ses_bounce",
        "ses_complaint",
        "postal_bounce",
        "postal_complaint",
      ],
      required: true,
    },
  },
  { timestamps: true }
);

ListSuppressionSchema.index({ listId: 1, email: 1 }, { unique: true });

export default mongoose.model<IListSuppression>("ListSuppression", ListSuppressionSchema);
