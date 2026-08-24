"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvedEnvPath = exports.nodeEnv = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.nodeEnv = process.env.NODE_ENV || "development";
const envByModePath = node_path_1.default.resolve(process.cwd(), `.env.${exports.nodeEnv}`);
const defaultEnvPath = node_path_1.default.resolve(process.cwd(), ".env");
const resolvedEnvPath = node_fs_1.default.existsSync(envByModePath) ? envByModePath : defaultEnvPath;
exports.resolvedEnvPath = resolvedEnvPath;
dotenv_1.default.config({ path: resolvedEnvPath });
//# sourceMappingURL=env.js.map