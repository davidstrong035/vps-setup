import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";
import { IUser } from "../types";

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 6 },
    role: {
      type: String,
      enum: ["user", "admin", "super_admin"],
      default: "user",
      index: true,
    },
    isActive: { type: Boolean, default: true },
    assignedDomainIds: [{ type: Schema.Types.ObjectId, ref: "SendingDomain", default: [] }],
    perDomainBatchSize: { type: Number, default: 1 }, // Number of emails to send per domain before rotating
    domainRotationIndex: { type: Number, default: 0 }, // Current index in round-robin domain rotation
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// never return password in JSON responses
UserSchema.set("toJSON", {
  transform: (_doc: any, ret: Record<string, any>) => {
    delete ret.password;
    return ret;
  },
});

export default mongoose.model<IUser>("User", UserSchema);
