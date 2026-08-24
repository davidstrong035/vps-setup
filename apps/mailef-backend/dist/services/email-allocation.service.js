"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserEmailAllocationHistory = exports.extendEmailAllocation = exports.updateEmailAllocationPurchasedCount = exports.suspendEmailAllocation = exports.consumeReservedEmailCredits = exports.releaseReservedEmailCredits = exports.reserveEmailCredits = exports.getEmailAllocationSummary = exports.getActiveEmailAllocation = exports.createEmailAllocation = exports.refreshEmailAllocationStatuses = void 0;
const EmailCreditAllocation_model_1 = __importDefault(require("../models/EmailCreditAllocation.model"));
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
const Campaign_model_1 = __importDefault(require("../models/Campaign.model"));
const toSnapshot = (allocation) => {
    if (!allocation)
        return null;
    return {
        _id: allocation._id.toString(),
        amountPaid: allocation.amountPaid,
        currency: allocation.currency,
        emailsPurchased: allocation.emailsPurchased,
        consumedEmails: allocation.consumedEmails,
        reservedEmails: allocation.reservedEmails,
        remainingEmails: Math.max(allocation.emailsPurchased - allocation.consumedEmails - allocation.reservedEmails, 0),
        paidAt: allocation.paidAt,
        expiresAt: allocation.expiresAt,
        receiptReference: allocation.receiptReference,
        note: allocation.note,
        status: allocation.status,
        createdAt: allocation.createdAt,
    };
};
const reconcileReservedEmails = async (allocation) => {
    if (!allocation)
        return null;
    // First, reset any "queued" recipients that belong to campaigns that are no
    // longer actively sending (paused, sent, draft, etc.). These are stale rows
    // that inflate reservedEmails and make the package appear depleted.
    const activeSendingCampaignIds = await Campaign_model_1.default.find({
        userId: allocation.userId,
        status: "sending",
    }).distinct("_id");
    await CampaignRecipient_model_1.default.updateMany({
        userId: allocation.userId,
        status: "queued",
        campaignId: { $nin: activeSendingCampaignIds },
    }, { $set: { status: "pending" } });
    // Now count only the genuinely queued recipients (active campaigns only).
    const queuedRecipients = await CampaignRecipient_model_1.default.countDocuments({
        userId: allocation.userId,
        status: "queued",
    });
    if (allocation.reservedEmails !== queuedRecipients) {
        allocation.reservedEmails = queuedRecipients;
        if (allocation.status === "consumed" &&
            allocation.expiresAt > new Date() &&
            allocation.consumedEmails < allocation.emailsPurchased) {
            allocation.status = "active";
        }
        await allocation.save();
    }
    return allocation;
};
const refreshEmailAllocationStatuses = async (userId) => {
    const baseQuery = { status: "active" };
    if (userId)
        baseQuery.userId = userId;
    await EmailCreditAllocation_model_1.default.updateMany({
        ...baseQuery,
        expiresAt: { $lte: new Date() },
    }, { $set: { status: "expired", reservedEmails: 0 } });
    await EmailCreditAllocation_model_1.default.updateMany({
        ...baseQuery,
        $expr: {
            $gte: ["$consumedEmails", "$emailsPurchased"],
        },
    }, { $set: { status: "consumed", reservedEmails: 0 } });
};
exports.refreshEmailAllocationStatuses = refreshEmailAllocationStatuses;
const createEmailAllocation = async (input) => {
    await (0, exports.refreshEmailAllocationStatuses)(input.userId);
    await EmailCreditAllocation_model_1.default.updateMany({
        userId: input.userId,
        status: "active",
    }, { $set: { status: "superseded", reservedEmails: 0 } });
    return EmailCreditAllocation_model_1.default.create({
        ...input,
        currency: input.currency.toUpperCase(),
        status: "active",
    });
};
exports.createEmailAllocation = createEmailAllocation;
const getActiveEmailAllocation = async (userId) => {
    await (0, exports.refreshEmailAllocationStatuses)(userId);
    // Also include "consumed" allocations that are not yet expired — they may
    // have been incorrectly marked consumed due to stale reservedEmails.
    // reconcileReservedEmails will restore the status to "active" if needed.
    const allocation = await EmailCreditAllocation_model_1.default.findOne({
        userId,
        status: { $in: ["active", "consumed"] },
        expiresAt: { $gt: new Date() },
    })
        .sort({ createdAt: -1 })
        .exec();
    return reconcileReservedEmails(allocation);
};
exports.getActiveEmailAllocation = getActiveEmailAllocation;
const getEmailAllocationSummary = async (userId) => {
    await (0, exports.refreshEmailAllocationStatuses)(userId);
    const [currentAllocation, recentAllocations] = await Promise.all([
        (0, exports.getActiveEmailAllocation)(userId),
        EmailCreditAllocation_model_1.default.find({ userId }).sort({ createdAt: -1 }).limit(5),
    ]);
    return {
        currentAllocation: toSnapshot(currentAllocation),
        recentAllocations: recentAllocations.map((item) => toSnapshot(item)).filter(Boolean),
    };
};
exports.getEmailAllocationSummary = getEmailAllocationSummary;
const reserveEmailCredits = async (allocationId, count) => {
    if (count <= 0)
        return null;
    return EmailCreditAllocation_model_1.default.findOneAndUpdate({
        _id: allocationId,
        status: "active",
        expiresAt: { $gt: new Date() },
        $expr: {
            $gte: [
                { $subtract: ["$emailsPurchased", { $add: ["$consumedEmails", "$reservedEmails"] }] },
                count,
            ],
        },
    }, { $inc: { reservedEmails: count } }, { returnDocument: "after" });
};
exports.reserveEmailCredits = reserveEmailCredits;
const releaseReservedEmailCredits = async (allocationId, count) => {
    if (count <= 0)
        return;
    const allocation = await EmailCreditAllocation_model_1.default.findById(allocationId);
    if (!allocation)
        return;
    allocation.reservedEmails = Math.max(allocation.reservedEmails - count, 0);
    if (allocation.status === "consumed" && allocation.expiresAt > new Date()) {
        allocation.status = "active";
    }
    await allocation.save();
};
exports.releaseReservedEmailCredits = releaseReservedEmailCredits;
const consumeReservedEmailCredits = async (allocationId, count) => {
    if (count <= 0)
        return;
    const allocation = await EmailCreditAllocation_model_1.default.findById(allocationId);
    if (!allocation)
        return;
    allocation.reservedEmails = Math.max(allocation.reservedEmails - count, 0);
    allocation.consumedEmails = Math.min(allocation.consumedEmails + count, allocation.emailsPurchased);
    if (allocation.expiresAt <= new Date()) {
        allocation.status = "expired";
    }
    else if (allocation.consumedEmails >= allocation.emailsPurchased) {
        allocation.status = "consumed";
        allocation.reservedEmails = 0;
    }
    else if (allocation.status !== "superseded") {
        allocation.status = "active";
    }
    await allocation.save();
};
exports.consumeReservedEmailCredits = consumeReservedEmailCredits;
const suspendEmailAllocation = async (allocationId, reason) => {
    const allocation = await EmailCreditAllocation_model_1.default.findById(allocationId);
    if (!allocation) {
        throw new Error("Email allocation not found");
    }
    allocation.status = "suspended";
    allocation.note = reason || allocation.note || "";
    await allocation.save();
    return allocation;
};
exports.suspendEmailAllocation = suspendEmailAllocation;
const updateEmailAllocationPurchasedCount = async (input) => {
    if (!Number.isInteger(input.emailsPurchased) || input.emailsPurchased <= 0) {
        throw new Error("emailsPurchased must be a positive integer");
    }
    const allocation = await EmailCreditAllocation_model_1.default.findOne({
        _id: input.allocationId,
        userId: input.userId,
    });
    if (!allocation) {
        throw new Error("Email allocation not found");
    }
    const minimumRequired = allocation.consumedEmails + allocation.reservedEmails;
    if (input.emailsPurchased < minimumRequired) {
        throw new Error(`emailsPurchased cannot be less than consumed + reserved (${minimumRequired})`);
    }
    allocation.emailsPurchased = input.emailsPurchased;
    if (input.note !== undefined) {
        allocation.note = input.note;
    }
    if (allocation.expiresAt <= new Date()) {
        allocation.status = "expired";
    }
    else if (allocation.consumedEmails >= allocation.emailsPurchased) {
        allocation.status = "consumed";
        allocation.reservedEmails = 0;
    }
    else if (!["superseded", "suspended"].includes(allocation.status)) {
        allocation.status = "active";
    }
    await allocation.save();
    return allocation;
};
exports.updateEmailAllocationPurchasedCount = updateEmailAllocationPurchasedCount;
const extendEmailAllocation = async (input) => {
    if (input.newExpiresAt <= new Date()) {
        throw new Error("New expiry date must be in the future");
    }
    const allocation = await EmailCreditAllocation_model_1.default.findOne({
        _id: input.allocationId,
        userId: input.userId,
    });
    if (!allocation)
        throw new Error("Email allocation not found");
    allocation.expiresAt = input.newExpiresAt;
    if (input.note !== undefined)
        allocation.note = input.note;
    // Restore status if it was only expired/consumed (not suspended/superseded)
    if (["expired", "consumed"].includes(allocation.status)) {
        if (allocation.consumedEmails < allocation.emailsPurchased) {
            allocation.status = "active";
            const queuedCount = await CampaignRecipient_model_1.default.countDocuments({
                userId: input.userId,
                status: "queued",
            });
            allocation.reservedEmails = queuedCount;
        }
    }
    await allocation.save();
    return allocation;
};
exports.extendEmailAllocation = extendEmailAllocation;
const getUserEmailAllocationHistory = async (userId, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    const [allocations, total] = await Promise.all([
        EmailCreditAllocation_model_1.default.find({ userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        EmailCreditAllocation_model_1.default.countDocuments({ userId }),
    ]);
    return {
        allocations: allocations.map(toSnapshot).filter((a) => a !== null),
        total,
        pages: Math.ceil(total / limit),
    };
};
exports.getUserEmailAllocationHistory = getUserEmailAllocationHistory;
//# sourceMappingURL=email-allocation.service.js.map