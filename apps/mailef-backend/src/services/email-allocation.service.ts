import EmailCreditAllocation from "../models/EmailCreditAllocation.model";
import CampaignRecipient from "../models/CampaignRecipient.model";
import Campaign from "../models/Campaign.model";
import { IEmailCreditAllocation } from "../types";

export interface EmailAllocationSnapshot {
  _id: string;
  amountPaid: number;
  currency: string;
  emailsPurchased: number;
  consumedEmails: number;
  reservedEmails: number;
  remainingEmails: number;
  paidAt: Date;
  expiresAt: Date;
  receiptReference?: string;
  note?: string;
  status: "active" | "expired" | "consumed" | "superseded" | "suspended";
  createdAt: Date;
}

const toSnapshot = (allocation: IEmailCreditAllocation | null): EmailAllocationSnapshot | null => {
  if (!allocation) return null;

  return {
    _id: allocation._id.toString(),
    amountPaid: allocation.amountPaid,
    currency: allocation.currency,
    emailsPurchased: allocation.emailsPurchased,
    consumedEmails: allocation.consumedEmails,
    reservedEmails: allocation.reservedEmails,
    remainingEmails: Math.max(
      allocation.emailsPurchased - allocation.consumedEmails - allocation.reservedEmails,
      0
    ),
    paidAt: allocation.paidAt,
    expiresAt: allocation.expiresAt,
    receiptReference: allocation.receiptReference,
    note: allocation.note,
    status: allocation.status,
    createdAt: allocation.createdAt,
  };
};

const reconcileReservedEmails = async (
  allocation: IEmailCreditAllocation | null
): Promise<IEmailCreditAllocation | null> => {
  if (!allocation) return null;

  // First, reset any "queued" recipients that belong to campaigns that are no
  // longer actively sending (paused, sent, draft, etc.). These are stale rows
  // that inflate reservedEmails and make the package appear depleted.
  const activeSendingCampaignIds = await Campaign.find({
    userId: allocation.userId,
    status: "sending",
  }).distinct("_id");

  await CampaignRecipient.updateMany(
    {
      userId: allocation.userId,
      status: "queued",
      campaignId: { $nin: activeSendingCampaignIds },
    },
    { $set: { status: "pending" } }
  );

  // Now count only the genuinely queued recipients (active campaigns only).
  const queuedRecipients = await CampaignRecipient.countDocuments({
    userId: allocation.userId,
    status: "queued",
  });

  if (allocation.reservedEmails !== queuedRecipients) {
    allocation.reservedEmails = queuedRecipients;

    if (
      allocation.status === "consumed" &&
      allocation.expiresAt > new Date() &&
      allocation.consumedEmails < allocation.emailsPurchased
    ) {
      allocation.status = "active";
    }

    await allocation.save();
  }

  return allocation;
};

export const refreshEmailAllocationStatuses = async (userId?: string): Promise<void> => {
  const baseQuery: any = { status: "active" };
  if (userId) baseQuery.userId = userId;

  await EmailCreditAllocation.updateMany(
    {
      ...baseQuery,
      expiresAt: { $lte: new Date() },
    },
    { $set: { status: "expired", reservedEmails: 0 } }
  );

  await EmailCreditAllocation.updateMany(
    {
      ...baseQuery,
      $expr: {
        $gte: ["$consumedEmails", "$emailsPurchased"],
      },
    },
    { $set: { status: "consumed", reservedEmails: 0 } }
  );
};

export const createEmailAllocation = async (input: {
  userId: string;
  assignedByUserId: string;
  amountPaid: number;
  currency: string;
  emailsPurchased: number;
  paidAt: Date;
  expiresAt: Date;
  receiptReference?: string;
  note?: string;
}): Promise<IEmailCreditAllocation> => {
  await refreshEmailAllocationStatuses(input.userId);

  await EmailCreditAllocation.updateMany(
    {
      userId: input.userId,
      status: "active",
    },
    { $set: { status: "superseded", reservedEmails: 0 } }
  );

  return EmailCreditAllocation.create({
    ...input,
    currency: input.currency.toUpperCase(),
    status: "active",
  });
};

export const getActiveEmailAllocation = async (
  userId: string
): Promise<IEmailCreditAllocation | null> => {
  await refreshEmailAllocationStatuses(userId);

  // Also include "consumed" allocations that are not yet expired — they may
  // have been incorrectly marked consumed due to stale reservedEmails.
  // reconcileReservedEmails will restore the status to "active" if needed.
  const allocation = await EmailCreditAllocation.findOne({
    userId,
    status: { $in: ["active", "consumed"] },
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .exec();

  return reconcileReservedEmails(allocation);
};

export const getEmailAllocationSummary = async (userId: string): Promise<{
  currentAllocation: EmailAllocationSnapshot | null;
  recentAllocations: EmailAllocationSnapshot[];
}> => {
  await refreshEmailAllocationStatuses(userId);

  const [currentAllocation, recentAllocations] = await Promise.all([
    getActiveEmailAllocation(userId),
    EmailCreditAllocation.find({ userId }).sort({ createdAt: -1 }).limit(5),
  ]);

  return {
    currentAllocation: toSnapshot(currentAllocation),
    recentAllocations: recentAllocations.map((item) => toSnapshot(item)!).filter(Boolean),
  };
};

export const reserveEmailCredits = async (
  allocationId: string,
  count: number
): Promise<IEmailCreditAllocation | null> => {
  if (count <= 0) return null;

  return EmailCreditAllocation.findOneAndUpdate(
    {
      _id: allocationId,
      status: "active",
      expiresAt: { $gt: new Date() },
      $expr: {
        $gte: [
          { $subtract: ["$emailsPurchased", { $add: ["$consumedEmails", "$reservedEmails"] }] },
          count,
        ],
      },
    },
    { $inc: { reservedEmails: count } },
    { returnDocument: "after" }
  );
};

export const releaseReservedEmailCredits = async (
  allocationId: string,
  count: number
): Promise<void> => {
  if (count <= 0) return;

  const allocation = await EmailCreditAllocation.findById(allocationId);
  if (!allocation) return;

  allocation.reservedEmails = Math.max(allocation.reservedEmails - count, 0);
  if (allocation.status === "consumed" && allocation.expiresAt > new Date()) {
    allocation.status = "active";
  }
  await allocation.save();
};

export const consumeReservedEmailCredits = async (
  allocationId: string,
  count: number
): Promise<void> => {
  if (count <= 0) return;

  const allocation = await EmailCreditAllocation.findById(allocationId);
  if (!allocation) return;

  allocation.reservedEmails = Math.max(allocation.reservedEmails - count, 0);
  allocation.consumedEmails = Math.min(
    allocation.consumedEmails + count,
    allocation.emailsPurchased
  );

  if (allocation.expiresAt <= new Date()) {
    allocation.status = "expired";
  } else if (allocation.consumedEmails >= allocation.emailsPurchased) {
    allocation.status = "consumed";
    allocation.reservedEmails = 0;
  } else if (allocation.status !== "superseded") {
    allocation.status = "active";
  }

  await allocation.save();
};
export const suspendEmailAllocation = async (
  allocationId: string,
  reason?: string
): Promise<IEmailCreditAllocation> => {
  const allocation = await EmailCreditAllocation.findById(allocationId);
  if (!allocation) {
    throw new Error("Email allocation not found");
  }

  allocation.status = "suspended";
  allocation.note = reason || allocation.note || "";
  await allocation.save();

  return allocation as IEmailCreditAllocation;
};

export const updateEmailAllocationPurchasedCount = async (input: {
  allocationId: string;
  userId: string;
  emailsPurchased: number;
  note?: string;
}): Promise<IEmailCreditAllocation> => {
  if (!Number.isInteger(input.emailsPurchased) || input.emailsPurchased <= 0) {
    throw new Error("emailsPurchased must be a positive integer");
  }

  const allocation = await EmailCreditAllocation.findOne({
    _id: input.allocationId,
    userId: input.userId,
  });

  if (!allocation) {
    throw new Error("Email allocation not found");
  }

  const minimumRequired = allocation.consumedEmails + allocation.reservedEmails;
  if (input.emailsPurchased < minimumRequired) {
    throw new Error(
      `emailsPurchased cannot be less than consumed + reserved (${minimumRequired})`
    );
  }

  allocation.emailsPurchased = input.emailsPurchased;
  if (input.note !== undefined) {
    allocation.note = input.note;
  }

  if (allocation.expiresAt <= new Date()) {
    allocation.status = "expired";
  } else if (allocation.consumedEmails >= allocation.emailsPurchased) {
    allocation.status = "consumed";
    allocation.reservedEmails = 0;
  } else if (!["superseded", "suspended"].includes(allocation.status)) {
    allocation.status = "active";
  }

  await allocation.save();
  return allocation as IEmailCreditAllocation;
};

export const extendEmailAllocation = async (input: {
  allocationId: string;
  userId: string;
  newExpiresAt: Date;
  note?: string;
}): Promise<IEmailCreditAllocation> => {
  if (input.newExpiresAt <= new Date()) {
    throw new Error("New expiry date must be in the future");
  }

  const allocation = await EmailCreditAllocation.findOne({
    _id: input.allocationId,
    userId: input.userId,
  });

  if (!allocation) throw new Error("Email allocation not found");

  allocation.expiresAt = input.newExpiresAt;
  if (input.note !== undefined) allocation.note = input.note;

  // Restore status if it was only expired/consumed (not suspended/superseded)
  if (["expired", "consumed"].includes(allocation.status)) {
    if (allocation.consumedEmails < allocation.emailsPurchased) {
      allocation.status = "active";
      const queuedCount = await CampaignRecipient.countDocuments({
        userId: input.userId,
        status: "queued",
      });
      allocation.reservedEmails = queuedCount;
    }
  }

  await allocation.save();
  return allocation as IEmailCreditAllocation;
};

export const getUserEmailAllocationHistory = async (
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ allocations: EmailAllocationSnapshot[]; total: number; pages: number }> => {
  const skip = (page - 1) * limit;

  const [allocations, total] = await Promise.all([
    EmailCreditAllocation.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean() as Promise<IEmailCreditAllocation[]>,
    EmailCreditAllocation.countDocuments({ userId }),
  ]);

  return {
    allocations: allocations.map(toSnapshot).filter((a) => a !== null) as EmailAllocationSnapshot[],
    total,
    pages: Math.ceil(total / limit),
  };
};
