# Per-User Pacing Architecture

## Overview

**Before:** Global serialized pacing meant all users waited for each other. User A, B, C would send sequentially.

**After:** Per-user pacing allows each user to send in parallel at their own interval. User A, B, C can send simultaneously from their own domains.

---

## Architecture

### How It Works

Each user's next allowed send time is stored in Redis:

```
Redis Key: user:pace:{userId}
Value: timestamp (milliseconds)
TTL: customIntervalMinutes * 60 * 1000 + 1000
```

When a job for a user arrives:

1. **Check user's next allowed send time** in Redis
2. **If waiting required:** sleep until that time
3. **Send email** immediately (no serialization)
4. **Update Redis:** set next allowed send time = now + interval
5. **Return:** next job processes immediately if from different user

---

## Timeline Example: 3 Users, 3-Minute Pacing

```
TIME     USER A                    USER B                    USER C
──────────────────────────────────────────────────────────────────────
0:00     Click send               Click send                Click send
         100 jobs queued          100 jobs queued           100 jobs queued

0:00:01  Job 1A starts            Job 1B queued             Job 1C queued
         Check Redis: no prev     (waiting turn)            (waiting turn)
         SEND ✓
         Store: Redis[userA]=0:03

0:00:10  Job 2A queued            Job 1B starts             Job 1C queued
         (waiting turn)           Check Redis: no prev      (waiting turn)
                                  SEND ✓
                                  Store: Redis[userB]=0:03

0:00:20                           Job 2B queued             Job 1C starts
         (waiting turn)           (waiting turn)            Check Redis: no prev
                                                            SEND ✓
                                                            Store: Redis[userC]=0:03

0:03:00  Job 1A already sent      Job 1B already sent       Job 1C already sent
         Job 2A starts            Job 2B starts             Job 2C starts
         Check Redis: 0:03:00     Check Redis: 0:03:00      Check Redis: 0:03:00
         NOW = 0:03:00            NOW = 0:03:00             NOW = 0:03:00
         No wait, SEND ✓          No wait, SEND ✓           No wait, SEND ✓
         Store: Redis[userA]=0:06 Store: Redis[userB]=0:06  Store: Redis[userC]=0:06

0:03:05  Job 3A starts            Job 3B starts             Job 3C starts
         Check Redis: 0:06:00     Check Redis: 0:06:00      Check Redis: 0:06:00
         NOW = 0:03:05            NOW = 0:03:05             NOW = 0:03:05
         Wait 2:55 ⏳              Wait 2:55 ⏳               Wait 2:55 ⏳

0:06:00  Job 3A SEND ✓            Job 3B SEND ✓             Job 3C SEND ✓
         Store: Redis[userA]=0:09 Store: Redis[userB]=0:09  Store: Redis[userC]=0:09
```

---

## Key Differences from Global Pacing

| Aspect                    | Global (Old)                           | Per-User (New)                         |
| ------------------------- | -------------------------------------- | -------------------------------------- |
| **Serialization**         | All jobs queue through `rateSlotChain` | Each user independent                  |
| **User A → B delay**      | 3 minutes (A finishes, B waits)        | Immediate (parallel)                   |
| **Scalability**           | Poor (bottleneck at worker)            | Excellent (truly parallel)             |
| **Storage**               | In-memory (`nextAllowedSendAt`)        | Redis (`user:pace:{userId}`)           |
| **Multi-user throughput** | ~1 email/3min total                    | ~3 emails/3min total (3 users)         |
| **Domain isolation**      | Global domain (shared reputation)      | Per-user domains (isolated reputation) |
| **Server restart impact** | Pacing resets (in-memory lost)         | Pacing persists (Redis survives)       |

---

## Quota & Rate Limit Integration

Pacing works **alongside** your existing quotas:

```
Email sending flow:

1. Dispatcher reserves quota (daily/global per user)
   └─ quota:global:day (500 total)
   └─ quota:user:A:day (500 per user)

2. Worker acquires concurrency slot
   └─ Max 5 parallel sends (configurable)

3. ★ Worker waits for pacing slot (per-user)
   └─ Each user's last send + 3 minutes
   └─ NEW: Stored in Redis per user

4. Worker checks per-user rate limits
   └─ User A: 100/min (optional, if set)
   └─ Skipped if not configured

5. Send email
   └─ Update domain counters
   └─ Mark campaign recipient as "sent"
```

---

## Configuration

### Set Global Pacing

```json
{
  "customIntervalMinutes": 3
}
```

This applies to all users. Send 1 email every 3 minutes, per user.

### Set Global Rate Limit (Fallback)

```json
{
  "workerRateLimitMax": 20,
  "workerRateLimitDurationMs": 60000
}
```

If `customIntervalMinutes` not set, calculates: gap = 60000 / 20 = 3000ms = 3 seconds per email.

### Override Per-User Rate Limits (Optional)

```json
{
  "scope": "user",
  "userId": "user123",
  "perMinute": 100,
  "perHour": 1000,
  "perDay": 5000
}
```

User gets stricter of (global or user override).

---

## Redis Keys

| Key                  | Purpose                         | TTL                                      | Format         |
| -------------------- | ------------------------------- | ---------------------------------------- | -------------- |
| `user:pace:{userId}` | Next allowed send time for user | customIntervalMinutes _ 60 _ 1000 + 1000 | Timestamp (ms) |

---

## Implications & Benefits

✅ **Scalable:** 100 concurrent users each sending at 3-min intervals = 100 emails/3 mins = ~2000 emails/hour  
✅ **Isolated:** Each user's reputation unaffected by others  
✅ **Persistent:** Pacing survives server restarts (stored in Redis)  
✅ **Fair:** Every user gets equal pacing interval  
✅ **Flexible:** Can adjust `customIntervalMinutes` globally for all users

---

## Future Enhancements

1. **Per-user custom intervals:** Store `customIntervalMinutes` on User model

   ```ts
   if (user.customIntervalMinutes) {
     gapMs = user.customIntervalMinutes * 60 * 1000;
   } else {
     gapMs = platformGlobalInterval;
   }
   ```

2. **Reputation-based pacing:** Adjust interval based on domain reputation score

   ```ts
   if (domain.reputationScore < 50) {
     gapMs = 5 * 60 * 1000; // 5 min for low-rep domains
   }
   ```

3. **Warm-up pacing:** Auto-reduce interval as domain warms up
   ```ts
   const weeksSinceCreation =
     (now - domain.createdAt) / (7 * 24 * 60 * 60 * 1000);
   gapMs = Math.max(180_000, 180_000 - weeksSinceCreation * 10_000);
   ```

---

## Testing

To verify per-user pacing works:

1. Start 3 campaigns from different users
2. Check logs: `[DomainRotation] Selected domain: ...`
3. Verify emails appear in logs at ~3-minute intervals per user
4. Check Redis: `redis-cli get "user:pace:{userId}"`
5. Confirm timestamps show next allowed send time per user

---

## Migration Notes

- **No data migration needed** (Redis is ephemeral)
- **Pacing state resets** on first deployment (normal)
- **Existing campaigns continue** (no breaking changes)
- **Quota system unchanged** (still enforced)
- **Rate limits unchanged** (still enforced)
