# Scalability Analysis: 500 Concurrent Users

## Current Configuration (Defaults)

```
mailWorkerBootConcurrency = 5
dispatchIntervalMs = 5000 (5 seconds)
dispatchUsersPerTick = 20
dispatchMaxPerRun = 500
customIntervalMinutes = 3 (180 seconds per email)
```

---

## Scenario: 500 Users All Click "Send" Simultaneously

### Phase 1: Dispatcher Dispatch Loop (Every 5 seconds)

```
Tick 1 (0:00):
├─ Find campaigns with status "sending" or paused (with resumable pause reason)
├─ Select UP TO 20 DIFFERENT USERS (usersPerTick = 20)
│  └─ User1 → 1 campaign selected
│  └─ User2 → 1 campaign selected
│  └─ ...
│  └─ User20 → 1 campaign selected
│
├─ For each of 20 campaigns:
│  ├─ Check: user has email credits? YES
│  ├─ Call dispatchCampaign(campaign)
│  │  ├─ Reserve quota from Redis (daily/global limits)
│  │  ├─ Queue batch of recipients to mail-queue
│  │  │  └─ Default batch size = 100 recipients
│  │  └─ Return queued count
│  │
│  └─ If halted: skip rest of users for this tick
│
└─ Result: ~20-100 recipients queued per user = 400-2000 jobs queued

Tick 2 (0:05):
├─ Dispatcher runs again
├─ Select NEXT 20 DIFFERENT USERS (Users 21-40)
├─ Queue another 400-2000 jobs
│
└─ Queue now has: 800-4000 jobs total

Ticks 3-25 (0:10 to 2:00):
├─ Continue cycling through all 500 users
├─ Each tick services 20 new users
├─ 500 users ÷ 20 per tick = 25 ticks needed = 25 × 5 sec = 125 seconds
│
└─ After 2+ minutes: ALL 500 users' campaigns are queued

Timeline: 0:00 → 2:05 = All 500 users have jobs queued
```

**Result:** ~250,000 jobs queued (500 users × 500 recipients per campaign max)

---

### Phase 2: Worker Processing (The Bottleneck)

```
Worker configuration:
├─ mailWorkerBootConcurrency = 5 (max 5 emails in parallel)
├─ customIntervalMinutes = 3 (wait 3 minutes per user between sends)
└─ Per-user pacing: each user must wait 3 minutes before next send

Job processing:

Time 0:00-0:03:
├─ 5 concurrent jobs start processing
│  ├─ Job A (User1): acquires concurrency slot → checks pacing → SEND (takes ~500ms)
│  ├─ Job B (User2): acquires concurrency slot → checks pacing → SEND
│  ├─ Job C (User3): acquires concurrency slot → checks pacing → SEND
│  ├─ Job D (User4): acquires concurrency slot → checks pacing → SEND
│  └─ Job E (User5): acquires concurrency slot → checks pacing → SEND
│
├─ All 5 return immediately (~500ms each)
└─ activeSendCount drops back to 0

Time 0:00:01-3:00:
├─ Queue has ~250k jobs waiting
├─ Worker picks next 5 jobs from queue
├─ BUT: each job checks Redis: "user:pace:{userId}"
│  ├─ User1 already sent at 0:00, next allowed = 0:03
│  ├─ User2 already sent at 0:00, next allowed = 0:03
│  ├─ User3 already sent at 0:00, next allowed = 0:03
│  ├─ User4 already sent at 0:00, next allowed = 0:03
│  └─ User5 already sent at 0:00, next allowed = 0:03
│
├─ All 5 new jobs: SLEEP 2:59 (179 seconds)
├─ Worker is BLOCKED (sleeping, not processing queue)
└─ activeSendCount = 5 (sleeping, not released yet)

Time 3:00-3:00:05:
├─ All 5 sleeps finish
├─ Concurrency slots release
├─ Worker tries to pick next 5 jobs
│
└─ Result: 5 more jobs processed (Users 1-5 send again)

Timeline:
├─ 0:00-0:01: Send 5 emails (User1-5, batch 1)
├─ 0:01-3:00: Sleep (waiting for pacing)
├─ 3:00-3:01: Send 5 emails (User1-5, batch 2)
├─ 3:01-6:00: Sleep
├─ 6:00-6:01: Send 5 emails (User1-5, batch 3)
│
└─ Pattern: 5 emails every 3 minutes = 100 emails/hour

Total jobs to process: 250,000
At 100 emails/hour: 250,000 ÷ 100 = 2,500 hours = 104 days ❌ TERRIBLE
```

---

## The Problem: Per-User Pacing + Low Concurrency

| Parameter                 | Current          | Problem                                                   |
| ------------------------- | ---------------- | --------------------------------------------------------- |
| **workerConcurrency**     | 5                | Only 5 jobs can process at a time                         |
| **customIntervalMinutes** | 3                | 180-second wait BLOCKS concurrency slots                  |
| **Sleep blocks slots**    | YES              | While Job A sleeps for 3 min, slot is held (not released) |
| **Throughput**            | ~100 emails/hour | Way too slow for 500 concurrent users                     |

**The bottleneck:** Sleeping jobs hold concurrency slots, blocking new work.

---

## Solution: Release Slots During Sleep

The fix is to **NOT hold the concurrency slot during pacing sleep**. Let me show you the code change:

### Current (Broken) Code:

```typescript
const releaseConcurrencySlot = await acquireConcurrencySlot();

try {
  await waitForPerUserPacedSendSlot(userId);  // ← Sleeps 3 minutes WHILE HOLDING SLOT
  const messageId = await sendEmail(...);
  // ... more work ...
} finally {
  releaseConcurrencySlot();  // ← Only released AFTER sleep + send
}
```

### Fixed Code:

```typescript
await waitForPerUserPacedSendSlot(userId);  // ← Sleep BEFORE acquiring slot

const releaseConcurrencySlot = await acquireConcurrencySlot();

try {
  const messageId = await sendEmail(...);  // ← Quick send, released immediately
  // ... more work ...
} finally {
  releaseConcurrencySlot();
}
```

**Effect:** Slots are released immediately after send, not held during sleep.

---

## With Fix: 500 Users Sending

```
Time 0:00-0:01:
├─ 5 concurrent jobs from different users
├─ User1, User2, User3, User4, User5 each SEND
├─ Jobs release slots immediately
└─ Throughput: 5 emails sent

Time 0:01-0:02:
├─ 5 NEW jobs from different users (User6-10, or retry of User1-5)
├─ Each checks pacing: User6 never sent before → NO WAIT
├─ Each SEND
├─ Jobs release slots
└─ Throughput: 5 emails sent

Time 0:02-0:03:
├─ 5 more new jobs
└─ Throughput: 5 emails sent

Time 0:03-0:04:
├─ User1 has now waited 3 minutes since first send
├─ If User1 job queued: checks Redis "user:pace:User1" → allowed now
├─ SEND immediately (no wait this time)
└─ Throughput: 5 emails sent

Pattern: 5 emails per second = 18,000 emails/hour ✅ MUCH BETTER
```

---

## Scalability Analysis: Fixed Version

### Worst Case: 500 Users, Each with 500 Recipients = 250,000 Jobs

```
Configuration (optimized):
├─ workerConcurrency = 50 (increased from 5)
├─ customIntervalMinutes = 3
├─ Mail send time ~500ms per email
└─ Network I/O = dominant cost

Processing time:

5 concurrent slots:
├─ Job 1: acquire slot → SLEEP for pacing (no user sent before) → SEND 500ms → release
├─ Job 2: sleep → send → release
├─ Job 3: sleep → send → release
├─ Job 4: sleep → send → release
├─ Job 5: sleep → send → release

Steady state (most jobs already have paced):
├─ Each job: ~100ms Redis check + ~500ms SEND = 600ms per job
├─ With 5 slots: 5 jobs × 600ms = ~600ms to process 5 jobs (parallel)
├─ Throughput: 5 jobs / 0.6s = 8-9 jobs per second

Total jobs to process: 250,000
At 8 jobs/sec: 250,000 ÷ 8 = 31,250 seconds = 8.6 hours ✅ GOOD

But only for users whose pacing has EXPIRED.
If all 500 users just sent:
├─ All must wait 3 minutes before next batch
├─ Worker is IDLE for 3 minutes
├─ Then 500 users can send again (distributed across concurrency slots)
```

---

## With Per-User Pacing: Real Throughput

```
Batch sizes:
├─ Dispatcher queues 100 recipients per user per tick
├─ 20 users × 100 recipients = 2,000 jobs per dispatcher tick (every 5 sec)
└─ 2,000 jobs ÷ 5 sec = 400 jobs/sec arrival rate

But pacing throttles sends:
├─ User A: send 1 email, wait 3 min
├─ User B: send 1 email, wait 3 min
├─ User C: send 1 email, wait 3 min
│ ...
├─ User 500: send 1 email, wait 3 min

If you have 500 concurrent users:
├─ In first 3 minutes: 500 users each send 1 email = 500 emails
├─ 500 emails ÷ 180 seconds = 2.7 emails/second
├─ With 5 concurrent slots: can process much faster
└─ Real throughput: MIN(queue arrival, pacing limit, concurrency)
   = MIN(400/sec, 2.7/sec, 5/sec) = 2.7 emails/sec

Total: 250,000 emails ÷ 2.7/sec = 92,600 seconds = 25.7 hours ⏳
```

---

## Recommendations for 500 Concurrent Users

### Option 1: Keep Global Pacing (Current)

```
Use case: Compliance, warm-up phase, reputation building
Throughput: ~2-3 emails/sec (250k emails = 24-30 hours)
Benefit: Slow, steady, lowest bounce/complaint rates
```

### Option 2: Increase Concurrency, Keep 3-min Pacing

```
Configuration:
├─ workerConcurrency = 50 (instead of 5)
├─ customIntervalMinutes = 3
└─ Run 2-3 worker processes in parallel (scale horizontally)

Throughput: ~50 emails/sec (250k emails = 83-100 minutes) ✅ GOOD
Benefit: Balanced speed & reputation
Cost: More CPU/memory
```

### Option 3: Per-Domain or Per-Relay Pacing (Future Enhancement)

```
Instead of global 3-min interval:
├─ Domain A: 3-min interval (low reputation, warming up)
├─ Domain B: 1-min interval (high reputation)
├─ Domain C: 30-sec interval (excellent reputation)

Throughput: Variable by domain (100-500 emails/sec possible)
Benefit: Maximum flexibility & speed
Cost: Complex to implement
```

### Option 4: No Pacing (Not Recommended)

```
If removed entirely:
├─ 500 concurrent slots
├─ Could process 250k emails in ~9 minutes
└─ But: High bounce/complaint rates, ISP blocks, reputation tanked
```

---

## Database & Redis Load @ 500 Concurrent Users

```
Database queries per email:
├─ CampaignRecipient.findByIdAndUpdate() → update status to "sent"
├─ Campaign.findByIdAndUpdate() → increment sent count
├─ SendingDomain.findOneAndUpdate() → increment usedToday
└─ 3 queries × ~50 emails/sec = 150 queries/sec

Redis operations per email:
├─ redis.get(user:pace:{userId}) → check pacing
├─ redis.set(user:pace:{userId}) → update pacing
├─ quota:global:day, quota:user:{userId}:day (via dispatcher)
└─ ~3 ops × 50 emails/sec = 150 ops/sec

Assessment:
├─ 150 queries/sec is reasonable for MongoDB
├─ 150 Redis ops/sec is trivial (Redis can handle 10,000+/sec)
└─ Bottleneck: SENDING (network I/O to SMTP/SES), NOT database
```

---

## Verdict: Scalability for 500 Users

| Scenario                       | Current Config | With Fix                            | Verdict           |
| ------------------------------ | -------------- | ----------------------------------- | ----------------- |
| **500 users, 500 emails each** | 25+ hours      | 8-12 hours                          | ⚠️ Slow but works |
| **100 users, 100 emails each** | 2-3 hours      | 30-40 min                           | ✅ Good           |
| **Instant throughput**         | ~2-3/sec       | ~50-100/sec (with more concurrency) | ✅ Acceptable     |
| **Reputation/Bounce rate**     | Excellent      | Good-Excellent                      | ✅ Safe           |

---

## Recommended Next Steps

1. **Move pacing sleep BEFORE concurrency slot acquisition** (releases slots faster)
2. **Increase `workerConcurrency` to 20-50** (allows more parallel sends)
3. **Run multiple worker instances** (horizontal scaling via PM2)
4. **Monitor Redis pacing keys** to ensure per-user tracking works
5. **Set aggressive daily quotas** (avoid stalling on one user)

Would you like me to implement the slot-release fix?
