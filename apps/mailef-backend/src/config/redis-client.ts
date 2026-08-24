import Redis from "ioredis";
import { redisConnection } from "./redis";

let redisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(redisConnection);
  return redisClient;
};
