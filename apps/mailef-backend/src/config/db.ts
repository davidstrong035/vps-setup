import "./env";
import mongoose from "mongoose";
import { logger } from "../utils/logger";

const connectDB = async (): Promise<void> => {
  const isProduction = process.env.NODE_ENV === "production";
  const uri = isProduction
    ? process.env.MONGODB_URI_PROD || process.env.MONGODB_URI
    : process.env.MONGODB_URI_DEV || process.env.MONGODB_URI;

  if (!uri) {
    logger.error(
      isProduction
        ? "Missing MongoDB URI: set MONGODB_URI_PROD (or MONGODB_URI)"
        : "Missing MongoDB URI: set MONGODB_URI_DEV (or MONGODB_URI)"
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error("MongoDB connection error", { error });
    process.exit(1);
  }
};

export default connectDB;
