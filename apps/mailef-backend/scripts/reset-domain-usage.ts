// reset-domain-usage.ts
// Script to reset usedToday=0 for all sending domains. Run this via cron daily.

import connectDB from '../src/config/db';
import { logger } from '../src/utils/logger';
import { SendingDomain } from '../src/models/SendingDomain.model';

async function main() {
  const env = process.env.NODE_ENV || 'development';
  logger.info(`Running reset-domain-usage script in ${env} mode`);
  await connectDB();
  const result = await SendingDomain.updateMany({}, { usedToday: 0 });
  logger.info(`Reset usedToday for ${result.modifiedCount} domains.`);
  await (await import('mongoose')).disconnect();
}

main().catch((err) => {
  logger.error('Failed to reset domain usage', { err });
  process.exit(1);
});
