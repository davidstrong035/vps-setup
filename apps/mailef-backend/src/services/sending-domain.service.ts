import { SendingDomain, type ISendingDomain } from '../models/SendingDomain.model';
import User from '../models/User.model';
import { getActiveSmtpRelays } from './smtp-relay.service';
import { Types } from 'mongoose';

const buildEligibleDomainQuery = (now = new Date()) => ({
  isActive: true,
  blocklisted: { $ne: true },
  verificationStatus: 'verified',
  $and: [
    {
      $or: [{ cooldownUntil: { $exists: false } }, { cooldownUntil: { $lte: now } }],
    },
    {
      $or: [
        { dailyQuota: { $exists: false } },
        { dailyQuota: null },
        { $expr: { $lt: ['$usedToday', '$dailyQuota'] } },
      ],
    },
  ],
});

const normalizeRelayIds = (relayIds?: Array<unknown>): string[] =>
  Array.from(
    new Set(
      (relayIds || [])
        .map((relayId) => String(relayId || '').trim())
        .filter(Boolean)
    )
  );

const isDomainCompatibleWithRelays = (
  domain: Pick<ISendingDomain, 'smtpRelayIds'>,
  activeRelayIds: string[]
): boolean => {
  const mappedRelayIds = normalizeRelayIds((domain.smtpRelayIds || []) as Array<unknown>);

  if (mappedRelayIds.length === 0 || activeRelayIds.length === 0) {
    return true;
  }

  return mappedRelayIds.some((relayId) => activeRelayIds.includes(relayId));
};

const resolveActiveRelayIds = async (userId?: string | null): Promise<string[]> => {
  try {
    const relays = await getActiveSmtpRelays(userId);
    return relays.map((relay) => relay.id).filter(Boolean);
  } catch {
    return [];
  }
};

export async function getEligibleSendingDomains(options: { activeRelayIds?: string[]; userId?: string | null } = {}): Promise<ISendingDomain[]> {
  const baseQuery = buildEligibleDomainQuery();
  const userQuery = options.userId
    ? { ...baseQuery, userId: options.userId }
    : { ...baseQuery, userId: null };

  const domains = await SendingDomain.find(userQuery).sort({
    usedToday: 1,
    reputationScore: -1,
    isDefault: -1,
    domain: 1,
  });

  const activeRelayIds = options.activeRelayIds || (await resolveActiveRelayIds(options.userId));

  return domains.filter((domain) => isDomainCompatibleWithRelays(domain, activeRelayIds));
}

export async function getAvailableSendingDomainNames(): Promise<{
  domains: string[];
  defaultDomain: string | null;
}> {
  const domains = await getEligibleSendingDomains();

  return {
    domains: domains.map((domain) => domain.domain),
    defaultDomain: domains.find((domain) => domain.isDefault)?.domain || null,
  };
}

export async function getMappedSmtpRelayIdsForDomain(
  domain?: string | null
): Promise<string[] | null> {
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  if (!normalizedDomain) return null;

  const record = await SendingDomain.findOne({ domain: normalizedDomain })
    .select('smtpRelayIds')
    .lean();

  const relayIds = normalizeRelayIds((record?.smtpRelayIds || []) as Array<unknown>);
  return relayIds.length > 0 ? relayIds : null;
}

export async function getVerifiedDomainForRelay(
  relayId: string,
  userId?: string | null
): Promise<string | null> {
  let assignedIds: string[] = [];
  if (userId) {
    const userRecord = await User.findById(userId).select('assignedDomainIds').lean();
    assignedIds = (userRecord?.assignedDomainIds || []).map((id) => id.toString());
  }

  // Build a filter that only returns domains the user is allowed to send from
  const ownershipFilter = userId
    ? {
        $or: [
          { userId: new Types.ObjectId(userId) },
          ...(assignedIds.length > 0
            ? [{ userId: null, _id: { $in: assignedIds.map((id) => new Types.ObjectId(id)) } }]
            : []),
        ],
      }
    : { userId: null };

  const domain = await (SendingDomain as any).findOne({
    smtpRelayIds: new Types.ObjectId(relayId),
    verificationStatus: 'verified',
    isActive: true,
    ...ownershipFilter,
  })
    .select('domain')
    .lean();
  return (domain as any)?.domain || null;
}

export async function isSendingDomainEligible(domain?: string | null, userId?: string | null): Promise<boolean> {
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  if (!normalizedDomain) return false;

  // Check user-owned domain first
  if (userId) {
    const userMatch = await SendingDomain.findOne({
      domain: normalizedDomain,
      userId,
      ...buildEligibleDomainQuery(),
    }).select('_id smtpRelayIds').lean();

    if (userMatch) {
      const activeRelayIds = await resolveActiveRelayIds(userId);
      return isDomainCompatibleWithRelays(userMatch as Pick<ISendingDomain, 'smtpRelayIds'>, activeRelayIds);
    }

    // Check platform domain assigned to this user
    const userRecord = await User.findById(userId).select('assignedDomainIds').lean();
    const assignedIds = (userRecord?.assignedDomainIds || []).map((id) => id.toString());
    if (assignedIds.length > 0) {
      const platformMatch = await SendingDomain.findOne({
        domain: normalizedDomain,
        userId: null,
        _id: { $in: assignedIds },
        ...buildEligibleDomainQuery(),
      }).select('_id smtpRelayIds').lean();

      if (platformMatch) {
        const activeRelayIds = await resolveActiveRelayIds(userId);
        return isDomainCompatibleWithRelays(platformMatch as Pick<ISendingDomain, 'smtpRelayIds'>, activeRelayIds);
      }
    }

    return false;
  }

  // No userId — check platform domains only
  const match = await SendingDomain.findOne({
    domain: normalizedDomain,
    userId: null,
    ...buildEligibleDomainQuery(),
  }).select('_id smtpRelayIds').lean();

  if (!match) return false;
  const activeRelayIds = await resolveActiveRelayIds(null);
  return isDomainCompatibleWithRelays(match as Pick<ISendingDomain, 'smtpRelayIds'>, activeRelayIds);
}

export async function selectSendingDomain(preferredDomain?: string | null, userId?: string | null): Promise<string | null> {
  // If user has assigned platform domains, restrict selection to those.
  let assignedDomainIds: string[] = [];
  if (userId) {
    const userRecord = await User.findById(userId).select('assignedDomainIds').lean();
    assignedDomainIds = (userRecord?.assignedDomainIds || []).map((id) => id.toString());
  }

  // Try user-owned domains first, fall back to platform domains (optionally filtered by assignment).
  let domains = userId ? await getEligibleSendingDomains({ userId }) : [];
  if (!domains.length) {
    let platformDomains = await getEligibleSendingDomains({ userId: null });
    if (assignedDomainIds.length > 0) {
      platformDomains = platformDomains.filter((d) => assignedDomainIds.includes(d._id.toString()));
    }
    domains = platformDomains;
  }
  if (!domains.length) return null;

  const normalizedPreferredDomain = String(preferredDomain || '').trim().toLowerCase();
  if (normalizedPreferredDomain) {
    const preferred = domains.find((domain) => domain.domain === normalizedPreferredDomain);
    if (preferred) {
      return preferred.domain;
    }
  }

  return domains[0].domain;
}
