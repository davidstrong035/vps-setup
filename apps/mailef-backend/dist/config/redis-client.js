"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisClient = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const redis_1 = require("./redis");
let redisClient = null;
const getRedisClient = () => {
    if (redisClient) {
        return redisClient;
    }
    redisClient = new ioredis_1.default(redis_1.redisConnection);
    return redisClient;
};
exports.getRedisClient = getRedisClient;
//# sourceMappingURL=redis-client.js.map