import dotenv from "dotenv";
import { getRedisClient } from "../config/redis-client";
import { logger } from "../utils/logger";

dotenv.config();

type WindowName = "minute" | "hour" | "day";

const MAX_COUNT_PER_SCAN = 200;
const TTL_SKEW_TOLERANCE_MS = 60_000;

const getCurrentUtcTokens = (nowMs: number): Record<WindowName, string> => {
  const now = new Date(nowMs);
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mi = now.getUTCMinutes().toString().padStart(2, "0");

  return {
    minute: `${yyyy}${mm}${dd}${hh}${mi}`,
    hour: `${yyyy}${mm}${dd}${hh}`,
    day: `${yyyy}${mm}${dd}`,
  };
};

const getExpectedTtlMs = (window: WindowName, nowMs: number): number => {
  if (window === "minute") return 60_000 - (nowMs % 60_000) + 1_000;
  if (window === "hour") return 3_600_000 - (nowMs % 3_600_000) + 1_000;

  const now = new Date(nowMs);
  const dayStartUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return dayStartUtcMs + 86_400_000 - nowMs + 1_000;
};

const parseQuotaKey = (key: string): { window: WindowName; token: string } | null => {
  const globalMatch = key.match(/^quota:global:(minute|hour|day):(\d+)$/);
  if (globalMatch) {
    return {
      window: globalMatch[1] as WindowName,
      token: globalMatch[2],
    };
  }

  const userMatch = key.match(/^quota:user:[^:]+:(minute|hour|day):(\d+)$/);
  if (userMatch) {
    return {
      window: userMatch[1] as WindowName,
      token: userMatch[2],
    };
  }

  return null;
};

const scanQuotaKeys = async (redis: ReturnType<typeof getRedisClient>): Promise<string[]> => {
  let cursor = "0";
  const keys: string[] = [];

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      "quota:*",
      "COUNT",
      MAX_COUNT_PER_SCAN
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");

  return keys;
};

export const cleanupQuotaKeys = async (): Promise<void> => {
  const redis = getRedisClient();
  const nowMs = Date.now();
  const currentTokens = getCurrentUtcTokens(nowMs);

  const keys = await scanQuotaKeys(redis);
  let deleted = 0;
  let ttlRepaired = 0;
  let skipped = 0;

  for (const key of keys) {
    const parsed = parseQuotaKey(key);

    if (!parsed) {
      skipped += 1;
      continue;
    }

    const expectedToken = currentTokens[parsed.window];
    if (parsed.token !== expectedToken) {
      await redis.del(key);
      deleted += 1;
      logger.info("Deleted stale quota key from previous window", { key });
      continue;
    }

    const ttlMs = await redis.pttl(key);

    // -2: key disappeared between scan and check
    if (ttlMs === -2) {
      continue;
    }

    // -1: no expiry (dangerous for quota keys)
    if (ttlMs === -1) {
      await redis.del(key);
      deleted += 1;
      logger.info("Deleted quota key with missing expiry", { key });
      continue;
    }

    const expectedTtlMs = getExpectedTtlMs(parsed.window, nowMs);
    if (ttlMs > expectedTtlMs + TTL_SKEW_TOLERANCE_MS) {
      await redis.pexpire(key, expectedTtlMs);
      ttlRepaired += 1;
      logger.info("Repaired abnormally long quota key TTL", {
        key,
        ttlMs,
        expectedTtlMs,
      });
    }
  }

  logger.info("Quota cleanup complete", { deleted, ttlRepaired, skipped, scanned: keys.length });
};

if (require.main === module) {
  cleanupQuotaKeys()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Quota cleanup failed:", err);
      logger.error("Quota cleanup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}
