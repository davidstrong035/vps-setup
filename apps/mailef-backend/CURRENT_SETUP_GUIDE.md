# Current Setup & Scaling Path

## Your Current Infrastructure

```
┌─────────────────────────────────────┐
│  VPS #1 (Single Server)             │
├─────────────────────────────────────┤
│  ├─ Backend Server (Node.js)        │
│  ├─ Mail Worker                     │
│  ├─ Campaign Dispatcher             │
│  └─ PM2 Process Manager             │
└─────────────────────────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
Postal #1    Postal #2
(SMTP #1)    (SMTP #2)
  Relay A       Relay B

Shared:
├─ MongoDB (external or local)
├─ Redis (external or local)
└─ S3 (for email lists)
```

---

## Key Insight: You Already Have Redundancy!

Two Postal relays means:

- **Domain rotation works per-user** (User A cycles Domain A → Domain B)
- **If Postal #1 fails**, jobs retry via Postal #2
- **No single point of failure** for sending

---

## Optimization for Current Setup (1 Server, 2 Postal Relays)

### Configuration Now

```json
{
  "workerConcurrency": 50,
  "customIntervalMinutes": 3,
  "workerRateLimitMax": 600,
  "workerRateLimitDurationMs": 60000
}
```

**Or via environment:**

```bash
export MAIL_WORKER_CONCURRENCY=50
export CUSTOM_INTERVAL_MINUTES=3
export MAIL_RATE_LIMIT_MAX=600
export MAIL_RATE_LIMIT_DURATION_MS=60000
```

### Throughput at This Scale

```
Single server, concurrency=50:
├─ ~100 emails per second (at full capacity)
├─ ~360,000 emails per hour
├─ ~8.6 million emails per day
│
└─ This is plenty for initial phase!
```

### Monitor CPU/Memory

If you hit these thresholds, **THEN** scale:

```
CPU Usage:
├─ < 60%: You're safe, increase workerConcurrency if needed
├─ 60-80%: Getting close, monitor closely
└─ > 80%: Time to add VPS #2 with second backend instance

Memory Usage:
├─ < 2GB: Safe
├─ 2-3GB: Monitor
└─ > 3GB: Likely Redis/queue bloat, check configuration
```

---

## How Postal Relays Work with Your Setup

### Right Now (Single Backend)

```
Campaign queued:
├─ 100 recipients → mail-queue (Redis)

Worker processes:
├─ Job 1: User A, recipient 1
│  ├─ domain-rotation.service: User A's domain
│  ├─ getActiveSmtpRelays(UserA)
│  ├─ Picks Postal relay (Postal #1 or #2, random if both active)
│  ├─ Sends via Postal #1 (SMTP relay A)
│  └─ Updates domain counter
│
├─ Job 2: User B, recipient 1
│  ├─ getActiveSmtpRelays(UserB)
│  ├─ Picks available Postal relay
│  ├─ Sends via Postal #2
│  └─ Updates domain counter
│
└─ Continues...

Pacing:
├─ User A: waits 3 minutes before next send (Redis: user:pace:UserA)
├─ User B: waits 3 minutes before next send (Redis: user:pace:UserB)
└─ Multiple users cycle through in parallel ✅
```

### When Postal #1 Fails

```
Job tries to send via Postal #1:
├─ SMTP error: Connection refused
├─ Fails and retries (BullMQ default: 3 attempts)
├─ Next retry: tries Postal #2 (different IP/relay)
├─ OR: getActiveSmtpRelays() returns only Postal #2
├─ Sends successfully via Postal #2
└─ Job marked as "sent" ✅

No manual intervention needed!
```

---

## Scaling Path: From Now to Future

### Phase 1: RIGHT NOW (Current)

```
Configuration:
├─ 1 Backend Server (VPS #1)
├─ 2 Postal Relays (handles redundancy)
├─ workerConcurrency = 50
├─ customIntervalMinutes = 3
└─ Per-user pacing in Redis

Capacity:
├─ Up to 100 concurrent users ✅
├─ 8.6M emails/day
├─ Monitor for bottlenecks

Cost:
├─ 1 VPS
├─ 2 Postal accounts
└─ Minimal
```

### Phase 2: When CPU > 80%

```
Option A: Vertical Scaling (Same VPS #1)
├─ Increase workerConcurrency to 100
├─ Add PM2 cluster mode (multiple processes)
├─ Uses more CPU/RAM on same server
└─ Cost: $0 (reconfig only)

Option B: Horizontal Scaling (Add VPS #2)
├─ Deploy second backend to VPS #2
├─ Add load balancer (Nginx)
├─ Shared Redis/MongoDB
├─ Each worker: concurrency = 50
├─ Total: 100 concurrent slots
└─ Cost: +$20-50/month for VPS #2

RECOMMENDATION: Try Option A first (cheaper)
If still maxed: Move to Option B
```

### Phase 3: Scale Beyond Single Server

```
When you need > 500 concurrent users or > 20M emails/day:

├─ Backend #1 (VPS #1): workerConcurrency = 50
├─ Backend #2 (VPS #2): workerConcurrency = 50
├─ Load Balancer: Routes API + Dispatcher
├─ Postal Relay #1: Via Backend #1
├─ Postal Relay #2: Via Backend #2
│
└─ Total: 100 concurrent slots + redundancy ✅
```

---

## For Your Current Setup: What NOT to Do Yet

❌ **Don't** set up load balancer (only 1 server)  
❌ **Don't** configure multiple backend instances (only 1 VPS)  
❌ **Don't** worry about dispatcher coordination (only 1 dispatcher)  
❌ **Don't** overthink Redis clusters (single Redis is fine now)

✅ **DO** monitor your single server  
✅ **DO** use per-user pacing (already implemented)  
✅ **DO** increase workerConcurrency gradually (5 → 20 → 50)  
✅ **DO** have a playbook for VPS #2 deployment when needed

---

## Recommended NOW Configuration

File: `.env` or `ecosystem.config.js`

```bash
# Mail Worker
MAIL_WORKER_CONCURRENCY=50
MAIL_JOB_LOCK_DURATION_MS=180000
MAIL_JOB_STALLED_INTERVAL_MS=30000
MAIL_JOB_MAX_STALLED_COUNT=2

# Pacing
CUSTOM_INTERVAL_MINUTES=3

# Rate Limiting (Fallback if custom interval not set)
MAIL_RATE_LIMIT_MAX=600
MAIL_RATE_LIMIT_DURATION_MS=60000

# Dispatcher
ENABLE_ACTIVE_CAMPAIGN_DISPATCHER=true
ACTIVE_DISPATCH_INTERVAL_MS=5000
ACTIVE_DISPATCH_USERS_PER_TICK=20
CAMPAIGN_DISPATCH_MAX_PER_RUN=500

# Database
MONGODB_URI=your_mongo_connection
REDIS_URL=your_redis_connection

# Postal Relays (both available for failover)
POSTAL_RELAY_1=postal1.yourdomain.com
POSTAL_RELAY_2=postal2.yourdomain.com
```

---

## Testing This Setup

### Test 1: Single User, Multiple Sends

```bash
# Create campaign with 100 recipients
# Click "Send"

# Monitor logs:
tail -f /var/log/app.log

# Expected output:
# [DomainRotation] Selected domain: domain-a (index 0/2)
# [DomainRotation] Selected domain: domain-b (index 1/2)
# [DomainRotation] Selected domain: domain-a (index 0/2)
# ...repeating every 3 minutes

# Check Redis pacing:
redis-cli GET "user:pace:userId123"
# Returns: timestamp of next allowed send
```

### Test 2: Concurrent Users

```bash
# Create campaigns for 10 different users
# All click "Send" at same time

# Monitor:
tail -f /var/log/app.log | grep "Email sent"

# Expected: emails sent continuously (not in batches)
# Not every 3 minutes, but staggered per user
```

### Test 3: Postal Relay Failover

```bash
# Kill Postal #1 (simulate failure)
# Keep sending emails

# Expected:
# First attempts fail via Postal #1
# Retries succeed via Postal #2
# No user-visible failures
```

---

## Migration to Multi-Server (When Ready)

When you need VPS #2:

### Step 1: Deploy Backend to VPS #2

```bash
# On VPS #2:
git clone your-repo
cd mailef-backend
npm install
npm run build

# Set same environment variables
export MONGODB_URI=...same...
export REDIS_URL=...same...

# Start
pm2 start ecosystem.config.js --env production
```

### Step 2: Add Load Balancer (Nginx)

```nginx
# On VPS #1 or separate machine:
upstream backend {
    least_conn;
    server vps1.example.com:3000;
    server vps2.example.com:3000;
}

server {
    listen 80;
    server_name api.maileff.com;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

### Step 3: Point Frontend & APIs to Load Balancer

```
Before: api.maileff.com → VPS #1 directly
After:  api.maileff.com → Nginx → VPS #1 or VPS #2 (round-robin)
```

Done! You now have 2 backend servers behind load balancer.

---

## Your Postal Relay Setup

### Current State

```
Postal #1:
├─ Handles sends for User A's Domain A
├─ Handles sends for User C's Domain C
└─ IP: 1.2.3.4

Postal #2:
├─ Handles sends for User B's Domain B
├─ Handles sends for User A's Domain B (rotation)
└─ IP: 5.6.7.8
```

### Question for You

When your code does `getActiveSmtpRelays(userId)`:

- Does it return BOTH Postal relays?
- Or does each domain map to a specific Postal relay?

**If both relays are returned per user:**

```typescript
// Current behavior (good):
User A can send via either Postal #1 or #2
- Increases throughput
- Provides failover

// Domain rotation combines with relay selection:
Job 1: User A, Domain A → picks Postal relay A
Job 2: User A, Domain B → picks Postal relay B (different relay!)
```

**If each domain is tied to one relay:**

```typescript
// Also good, but less flexible:
Domain A → always Postal #1
Domain B → always Postal #2
// But if Postal #1 fails, Domain A fails until fixed
```

Check your `getActiveSmtpRelays()` function to confirm.

---

## Summary: Your Path Forward

**NOW:**

- Keep single server (VPS #1) with 50 concurrency
- Use per-user pacing (already implemented) ✅
- Monitor CPU/memory/email throughput
- Test with 10-100 concurrent users

**WHEN CPU > 80%:**

- Option 1: Increase concurrency to 100 (cheaper)
- Option 2: Add VPS #2 (scale linearly)

**WHEN POSTAL FAILS:**

- Automatic retry via other relay ✅
- No manual intervention needed

**LATER (500+ users):**

- Deploy to VPS #2
- Add load balancer
- Scale horizontally

This is a clean, pragmatic path that doesn't over-engineer early! 🚀
