import { v4 as uuidv4 } from "uuid";
import Campaign from "../models/Campaign.model";
import { getRedisClient } from "../config/redis-client";
import { dispatchCampaign } from "./campaign-dispatch.service";
import { getActiveEmailAllocation } from "./email-allocation.service";
import { getPlatformDispatchSettings } from "./platform-settings.service";
import { logger } from "../utils/logger";

let dispatcherTimer: NodeJS.Timeout | null = null;
let isDispatching = false;

const LOCK_KEY = "lock:active-campaign-dispatch";
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const takeDispatchLock = async (ttlMs: number): Promise<{ token: string } | null> => {
  const token = uuidv4();
  const redis = getRedisClient();
  const result = await redis.set(LOCK_KEY, token, "PX", ttlMs, "NX");

  if (result !== "OK") {
    return null;
  }

  return { token };
};

const releaseDispatchLock = async (token: string): Promise<void> => {
  const redis = getRedisClient();
  await redis.eval(RELEASE_LOCK_SCRIPT, 1, LOCK_KEY, token);
};

const getEligibleCampaignsByUser = async (usersPerTick: number) => {
  const pausedReasonsToResume = [
    "Campaign paused because your current send limit has been reached. Try again after the limit resets.",
    "Campaign paused because your email package has no remaining credits.",
  ];

  const candidates = await Campaign.find({
    $or: [
      { status: "sending" },
      {
        status: "paused",
        pauseReason: { $in: pausedReasonsToResume },
      },
    ],
  })
    .sort({ updatedAt: 1 })
    .limit(usersPerTick * 8);

  const selectedByUser = new Map<string, (typeof candidates)[number]>();

  for (const campaign of candidates) {
    const userId = campaign.userId.toString();
    if (!selectedByUser.has(userId)) {
      selectedByUser.set(userId, campaign);
    }

    if (selectedByUser.size >= usersPerTick) {
      break;
    }
  }

  return [...selectedByUser.values()];
};

const filterPayableReadyCampaigns = async (
  campaigns: Awaited<ReturnType<typeof getEligibleCampaignsByUser>>
) => {
  const eligible: typeof campaigns = [];

  for (const campaign of campaigns) {
    const activeAllocation = await getActiveEmailAllocation(campaign.userId.toString());
    const remainingCredits = activeAllocation
      ? Math.max(
          activeAllocation.emailsPurchased -
            activeAllocation.consumedEmails -
            activeAllocation.reservedEmails,
          0
        )
      : 0;

    if (activeAllocation && remainingCredits > 0) {
      eligible.push(campaign);
      continue;
    }

    await Campaign.findByIdAndUpdate(campaign._id, {
      $set: {
        status: "paused",
        pauseReason:
          "Campaign paused because your email package has no remaining credits.",
      },
    });
  }

  return eligible;
};

const dispatchActiveCampaigns = async () => {
  if (isDispatching) return;
  isDispatching = true;

  const dispatchSettings = await getPlatformDispatchSettings();
  if (!dispatchSettings.enabled) {
    isDispatching = false;
    return;
  }

  const lock = await takeDispatchLock(Math.max(dispatchSettings.intervalMs - 250, 1000));

  if (!lock) {
    isDispatching = false;
    return;
  }

  try {
    const campaigns = await getEligibleCampaignsByUser(dispatchSettings.usersPerTick);
    const payableCampaigns = await filterPayableReadyCampaigns(campaigns);

    for (const campaign of payableCampaigns) {
      try {
        // If campaign was previously paused for quota/rate-limit, log resumption
        if (
          campaign.status === "paused" &&
          [
            "Campaign paused because your current send limit has been reached. Try again after the limit resets.",
            "Campaign paused because your email package has no remaining credits."
          ].includes(campaign.pauseReason ?? "")
        ) {
          logger.info("Automatically resuming campaign after quota/rate-limit reset", {
            campaignId: campaign._id.toString(),
            userId: campaign.userId.toString(),
            previousPauseReason: campaign.pauseReason,
          });
        }

        const result = await dispatchCampaign(campaign);

        logger.info("Active campaign dispatch tick completed", {
          campaignId: campaign._id.toString(),
          userId: campaign.userId.toString(),
          queued: result.queued,
          rateLimited: result.rateLimited,
          creditLimited: result.creditLimited,
          alreadyCompleted: result.alreadyCompleted,
        });
      } catch (error) {
        logger.error("Active campaign dispatch failed", {
          campaignId: campaign._id.toString(),
          userId: campaign.userId.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await releaseDispatchLock(lock.token).catch(() => {
      // no-op; lock expires automatically
    });
    isDispatching = false;
  }
};

export const startActiveCampaignDispatcher = (): void => {
  if (dispatcherTimer) return;

  const scheduleNextTick = async () => {
    let delayMs = 5000;

    try {
      const settings = await getPlatformDispatchSettings();
      delayMs = settings.intervalMs;
    } catch (error) {
      logger.error("Failed to resolve active dispatcher interval", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    dispatcherTimer = setTimeout(() => {
      dispatchActiveCampaigns().catch((error) => {
        logger.error("Active campaign dispatcher tick failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => {
        scheduleNextTick().catch((scheduleError) => {
          logger.error("Failed to schedule next active dispatch tick", {
            error:
              scheduleError instanceof Error ? scheduleError.message : String(scheduleError),
          });
        });
      });
    }, delayMs);
  };

  scheduleNextTick().catch((error) => {
    logger.error("Failed to start active campaign dispatcher", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  dispatchActiveCampaigns().catch((error) => {
    logger.error("Initial active campaign dispatch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
};
