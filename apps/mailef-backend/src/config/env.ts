import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

export const nodeEnv = process.env.NODE_ENV || "development";
const envByModePath = path.resolve(process.cwd(), `.env.${nodeEnv}`);
const defaultEnvPath = path.resolve(process.cwd(), ".env");

const resolvedEnvPath = fs.existsSync(envByModePath) ? envByModePath : defaultEnvPath;

dotenv.config({ path: resolvedEnvPath });

export { resolvedEnvPath };