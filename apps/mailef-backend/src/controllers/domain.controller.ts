import { Request, Response } from 'express';
import { Types } from 'mongoose';
import SmtpRelay from '../models/SmtpRelay.model';
import { SendingDomain } from '../models/SendingDomain.model';
import User from '../models/User.model';

const getRouteId = (req: Request): string =>
  Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

const normalizeDomain = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const isValidDomain = (value: string): boolean =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    value
  );

const normalizeRelayIds = (value: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((relayId) => String(relayId || '').trim())
        .filter(Boolean)
    )
  );

const validateRelayIds = async (value: unknown): Promise<string | null> => {
  const relayIds = normalizeRelayIds(value);

  const invalidRelayId = relayIds.find((relayId) => !Types.ObjectId.isValid(relayId));
  if (invalidRelayId) {
    return 'One or more selected SMTP relay IDs are invalid.';
  }

  if (relayIds.length === 0) {
    return null;
  }

  const existingCount = await SmtpRelay.countDocuments({
    _id: { $in: relayIds.map((relayId) => new Types.ObjectId(relayId)) },
  });

  if (existingCount !== relayIds.length) {
    return 'One or more selected SMTP relays no longer exist.';
  }

  return null;
};

export const getAllDomains = async (_req: Request, res: Response) => {
  const domains = await SendingDomain.find().populate('userId', '_id name email').sort({ isDefault: -1, createdAt: -1 });

  // For platform domains (userId: null), reverse-lookup all users that have them assigned
  const platformDomainIds = domains
    .filter((d: any) => !d.userId)
    .map((d: any) => d._id);

  const usersWithAssignments = platformDomainIds.length > 0
    ? await User.find({ assignedDomainIds: { $in: platformDomainIds } })
        .select('_id name email assignedDomainIds')
        .lean()
    : [];

  // Build a map: domainId -> array of users
  const domainUsersMap = new Map<string, { _id: unknown; name?: string; email: string }[]>();
  for (const user of usersWithAssignments) {
    for (const domainId of (user.assignedDomainIds || [])) {
      const key = domainId.toString();
      if (!domainUsersMap.has(key)) domainUsersMap.set(key, []);
      domainUsersMap.get(key)!.push({ _id: user._id, name: user.name, email: user.email });
    }
  }

  const result = domains.map((d: any) => {
    const obj = d.toObject();
    if (obj.userId) {
      // user-owned domain
      obj.owner = obj.userId;
      obj.assignedUsers = [];
    } else {
      // platform domain — may be assigned to multiple users
      obj.owner = null;
      obj.assignedUsers = domainUsersMap.get(obj._id.toString()) || [];
    }
    delete obj.userId;
    return obj;
  });
  res.json(result);
};

export const createDomain = async (req: Request, res: Response) => {
  const normalizedDomain = normalizeDomain(req.body.domain);
  if (!isValidDomain(normalizedDomain)) {
    res.status(400).json({ message: 'Please provide a valid domain name.' });
    return;
  }

  const relayValidationError = await validateRelayIds(req.body.smtpRelayIds);
  if (relayValidationError) {
    res.status(400).json({ message: relayValidationError });
    return;
  }

  let userId: Types.ObjectId | null = null;
  if (req.body.userId) {
    if (!Types.ObjectId.isValid(req.body.userId)) {
      return res.status(400).json({ message: 'Invalid userId.' });
    }
    const user = await User.findById(req.body.userId);
    if (!user) {
      return res.status(400).json({ message: 'User not found.' });
    }
    userId = user._id;
  }

  if (req.body.isDefault === true) {
    await SendingDomain.updateMany({}, { $set: { isDefault: false } });
  }

  const domain = new SendingDomain({
    ...req.body,
    domain: normalizedDomain,
    smtpRelayIds: normalizeRelayIds(req.body.smtpRelayIds),
    userId: userId || undefined,
  });
  await domain.save();
  await domain.populate('userId', '_id name email');
  const obj = domain.toObject() as unknown as Record<string, unknown>;
  obj.owner = obj.userId || null;
  delete obj.userId;
  res.status(201).json(obj);
};

export const updateDomain = async (req: Request, res: Response) => {
  const id = getRouteId(req);
  const updates = { ...req.body } as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(updates, 'domain')) {
    const normalizedDomain = normalizeDomain(updates.domain);
    if (!isValidDomain(normalizedDomain)) {
      res.status(400).json({ message: 'Please provide a valid domain name.' });
      return;
    }
    updates.domain = normalizedDomain;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'smtpRelayIds')) {
    const relayValidationError = await validateRelayIds(updates.smtpRelayIds);
    if (relayValidationError) {
      res.status(400).json({ message: relayValidationError });
      return;
    }
    updates.smtpRelayIds = normalizeRelayIds(updates.smtpRelayIds);
  }

  if (updates.isDefault === true) {
    await SendingDomain.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
  }

  const domain = await SendingDomain.findByIdAndUpdate(id, updates, {
    returnDocument: 'after',
  }).populate('userId', '_id name email');
  if (!domain) {
    res.status(404).json({ message: 'Domain not found' });
    return;
  }
  const obj = domain.toObject() as unknown as Record<string, unknown>;
  obj.owner = obj.userId || null;
  delete obj.userId;
  res.json(obj);
};

export const deleteDomain = async (req: Request, res: Response) => {
  const id = getRouteId(req);
  const domain = await SendingDomain.findByIdAndDelete(id);
  if (!domain) {
    res.status(404).json({ message: 'Domain not found' });
    return;
  }
  res.json({ message: 'Domain deleted' });
};

export const setDefaultDomain = async (req: Request, res: Response) => {
  const id = getRouteId(req);

  const target = await SendingDomain.findById(id);
  if (!target) {
    res.status(404).json({ message: 'Domain not found' });
    return;
  }

  await SendingDomain.updateMany({}, { $set: { isDefault: false } });
  target.isDefault = true;
  await target.save();

  res.json(target);
};

export const setBlocklistStatus = async (req: Request, res: Response) => {
  const id = getRouteId(req);
  const { blocklisted } = req.body;
  const domain = await SendingDomain.findByIdAndUpdate(id, { blocklisted }, {
    returnDocument: 'after',
  });
  if (!domain) {
    res.status(404).json({ message: 'Domain not found' });
    return;
  }
  res.json(domain);
};

export const setCooldown = async (req: Request, res: Response) => {
  const id = getRouteId(req);
  const { cooldownUntil } = req.body;
  const domain = await SendingDomain.findByIdAndUpdate(id, { cooldownUntil }, {
    returnDocument: 'after',
  });
  if (!domain) {
    res.status(404).json({ message: 'Domain not found' });
    return;
  }
  res.json(domain);
};

export const setReputationScore = async (req: Request, res: Response) => {
  const id = getRouteId(req);
  const { reputationScore } = req.body;
  const domain = await SendingDomain.findByIdAndUpdate(id, { reputationScore }, {
    returnDocument: 'after',
  });
  if (!domain) {
    res.status(404).json({ message: 'Domain not found' });
    return;
  }
  res.json(domain);
};

export const resetBounceComplaint = async (req: Request, res: Response) => {
  const id = getRouteId(req);
  const domain = await SendingDomain.findByIdAndUpdate(
    id,
    { bounceCount: 0, complaintCount: 0 },
    { returnDocument: 'after' }
  );
  if (!domain) {
    res.status(404).json({ message: 'Domain not found' });
    return;
  }
  res.json(domain);
};

export const resetDomainUsage = async (req: Request, res: Response) => {
  const id = getRouteId(req);
  const domain = await SendingDomain.findByIdAndUpdate(id, { usedToday: 0 }, {
    returnDocument: 'after',
  });
  if (!domain) {
    res.status(404).json({ message: 'Domain not found' });
    return;
  }
  res.json(domain);
};
