# Deployment Checklist: Current Setup (1 Server, 2 Postal Relays)

## Pre-Deployment Verification

### Code Changes Applied ✅

- [x] Per-user pacing via Redis (waitForPerUserPacedSendSlot)
- [x] Domain rotation per user (getNextSendingDomain)
- [x] DLQ with error details (mail.dead-letter.queue)
- [x] Daily reset script (daily-reset.ts)
- [x] Custom interval support (customIntervalMinutes)
- [x] Concurrency slot management (waitForPacedSendSlot moved BEFORE slot acquisition)

### Build Status

```bash
npm run build
# Should complete without errors
```

✅ **Build verified successfully**

---

## Configuration Checklist

### Environment Variables (.env or ecosystem.config.js)

```bash
# ✅ Database
MONGODB_URI=your_connection_string
REDIS_URL=your_redis_connection

# ✅ Mail Configuration
MAIL_WORKER_CONCURRENCY=50
MAIL_JOB_LOCK_DURATION_MS=180000
CUSTOM_INTERVAL_MINUTES=3
MAIL_RATE_LIMIT_MAX=600
MAIL_RATE_LIMIT_DURATION_MS=60000

# ✅ Dispatcher
ENABLE_ACTIVE_CAMPAIGN_DISPATCHER=true
ACTIVE_DISPATCH_INTERVAL_MS=5000
ACTIVE_DISPATCH_USERS_PER_TICK=20
CAMPAIGN_DISPATCH_MAX_PER_RUN=500

# ✅ Postal Relays (both configured)
# Check your getActiveSmtpRelays() to see exact env vars needed
```

---

## Deployment Steps

### 1. Build Backend

```bash
cd /path/to/mailef-backend
npm run build

# Verify dist/ folder has:
# ├─ dist/queue/mail.worker.js ✅
# ├─ dist/services/domain-rotation.service.js ✅
# ├─ dist/scripts/daily-reset.js ✅
# └─ ...other files...
```

### 2. Stop Current Server

```bash
pm2 stop ecosystem.config.js
pm2 delete ecosystem.config.js

# Verify stopped
pm2 list  # Should be empty
```

### 3. Backup Current Data

```bash
# Backup MongoDB (if local)
mongodump --uri "$MONGODB_URI" -o ./backup-$(date +%s)

# Backup Redis (if local)
redis-cli BGSAVE
cp /var/lib/redis/dump.rdb ./redis-backup-$(date +%s).rdb
```

### 4. Deploy New Code

```bash
# Copy new code to production
scp -r dist/ user@vps1:/path/to/mailef-backend/

# Or if pulling from git:
git pull origin main
npm run build
```

### 5. Start Server with New Config

```bash
# Update ecosystem.config.js with new settings
# Then start:
pm2 start ecosystem.config.js --env production

# Verify running
pm2 list
pm2 logs mass-mailer-backend  # Watch logs
```

### 6. Run Daily Reset Script

```bash
# Schedule for 00:00 UTC (already in ecosystem.config.js)
# Or test manually:
pm2 start ecosystem.config.js --env production --only daily-reset
pm2 logs daily-reset

# Expected output:
# [daily-reset] connecting to mongo...
# [daily-reset] collection=sendingdomains matched=X modified=Y
# [daily-reset] done
```

---

## Verification Tests (Post-Deployment)

### Test 1: Basic Send

```bash
# Create test campaign with 1 recipient
# Click "Send"

# Check logs:
pm2 logs mass-mailer-backend | grep "Email sent"

# Expected: ✅ Email marked as sent in CampaignRecipient
```

### Test 2: Per-User Pacing

```bash
# Create campaign for User A with 5 recipients
# Click "Send"

# Monitor Redis pacing:
redis-cli GET "user:pace:userIdA"
# Returns: timestamp (next allowed send time)

# Create campaign for User B with 5 recipients
# Click "Send" at same time

# Expected:
# User A emails queued and sent
# User B emails queued and sent IN PARALLEL
# Not one after the other
```

### Test 3: Domain Rotation

```bash
# If User A has 2 domains assigned
# Send campaign with 10 recipients

# Check logs:
pm2 logs mass-mailer-backend | grep "DomainRotation"

# Expected output (alternating):
# [DomainRotation] Selected domain: domain-a.com (index 0/2)
# [DomainRotation] Selected domain: domain-b.com (index 1/2)
# [DomainRotation] Selected domain: domain-a.com (index 0/2)
# ...
```

### Test 4: Postal Relay Handling

```bash
# If Postal #1 fails:
# Send campaign
# Check that emails still send via Postal #2

# Check logs for retry behavior:
pm2 logs mass-mailer-backend | grep "Email failed"
# Should show retries, not permanent failures
```

### Test 5: DLQ (Dead Letter Queue)

```bash
# If email fails permanently:
# Check DLQ entries via Admin UI

# Expected: Full error details visible
# ├─ Error message
# ├─ Stack trace
# ├─ SMTP response code
# └─ Response body
```

---

## Performance Monitoring

### Check Worker Activity

```bash
# Watch active email sends:
watch -n 1 'pm2 logs mass-mailer-backend | grep -c "Email sent"'

# Expected: Multiple emails per second (not batchy)
```

### Monitor Redis Queue

```bash
# Queue length:
redis-cli LLEN mail-queue
# Should decrease as emails process

# Pacing keys:
redis-cli KEYS "user:pace:*" | wc -l
# Should show number of active users

# Per-user pacing timestamp:
redis-cli GET "user:pace:userId123"
# Should show future timestamp
```

### Monitor Database Load

```bash
# MongoDB query counts:
mongosh
db.campaignrecipients.countDocuments({ status: "sent" })
db.campaignrecipients.countDocuments({ status: "queued" })
db.campaignrecipients.countDocuments({ status: "failed" })

# Should see increasing sent count
```

### CPU/Memory Usage

```bash
# Check server resources:
top
# Look for node process
# CPU: should stay under 80%
# MEM: should stay under 2GB

# If exceeding:
# Option 1: Reduce workerConcurrency
# Option 2: Increase server resources
# Option 3: Prepare for VPS #2 deployment
```

---

## Troubleshooting

### No emails being sent

```bash
# Check worker is running:
pm2 list | grep mass-mailer-backend

# If not running:
pm2 logs mass-mailer-backend  # Check for errors

# Common issues:
# ✅ MongoDB connection down
# ✅ Redis connection down
# ✅ All campaigns paused (check status in DB)
# ✅ Rate limit reached (check daily quota in DB)
```

### Emails stuck in queue

```bash
# Check mail-queue size:
redis-cli LLEN mail-queue

# If size not decreasing:
# ✅ Worker crashed (pm2 list)
# ✅ Redis connection issue (redis-cli ping)
# ✅ Pacing blocking (check user:pace:* keys)

# Force reprocess:
pm2 restart mass-mailer-backend
```

### High CPU usage

```bash
# Reduce concurrency temporarily:
# In ecosystem.config.js, set MAIL_WORKER_CONCURRENCY=20

pm2 restart ecosystem.config.js --env production

# Monitor:
watch -n 1 'top -b -n 1 | grep node'

# If CPU drops to acceptable:
# You're hitting concurrency limit
# Options:
# - Add VPS #2
# - Increase server RAM/CPU
# - Reduce workerConcurrency further
```

### Redis connection errors

```bash
# Verify Redis is running:
redis-cli ping
# Should return: PONG

# If not:
# ✅ Redis service stopped (restart)
# ✅ Redis listening on wrong port (check config)
# ✅ Network connectivity (firewall rules)

# Test connection from app:
pm2 logs mass-mailer-backend | grep "Redis"
```

### Postal relay failures

```bash
# Check both relays are responding:
telnet postal1.yourdomain.com 25
telnet postal2.yourdomain.com 25

# Should see SMTP banner if connected

# Check relay status in admin:
# Are both relays marked as "active"?

# If one fails:
# Set to "inactive" in Admin UI
# System will use only active relays
```

---

## Daily Operations

### Morning (Start of Day)

```bash
# Check overnight sends:
redis-cli LLEN mail-queue
# Should be near 0 (all processed)

# Check for errors:
pm2 logs mass-mailer-backend --lines 100 | grep "failed\|error"

# Reset daily counters (automatic via cron at 00:00 UTC):
redis-cli DBSIZE  # Should be minimal
```

### Throughout Day

```bash
# Monitor queue length:
redis-cli LLEN mail-queue
# Should be reasonable (not growing unbounded)

# Monitor CPU:
top | grep node
# Should be < 80%

# Monitor active user pacing:
redis-cli KEYS "user:pace:*" | wc -l
# Should match roughly your concurrent users
```

### Evening

```bash
# Check total sent for day:
db.campaignrecipients.countDocuments({ status: "sent", sentAt: { $gte: ISODate("2024-06-03T00:00:00Z") } })

# Verify against quota:
# If over quota, investigate user limits

# Check for stuck jobs:
redis-cli LLEN mail-queue
# Should be 0 or very small
```

---

## When to Scale to VPS #2

Move to multi-server setup when:

```
✅ CPU consistently > 75%
✅ Mail queue regularly > 10,000 jobs
✅ Email send latency > 30 seconds
✅ More than 100 concurrent users expected
✅ Need redundancy for mission-critical sending
```

At that point:

1. Follow LOAD_BALANCER_SCALING.md
2. Deploy identical backend to VPS #2
3. Add Nginx load balancer
4. Update DNS to point to load balancer
5. Done!

---

## Rollback Plan

If something breaks after deployment:

```bash
# Stop current server:
pm2 stop ecosystem.config.js

# Revert code:
git checkout previous-version
npm run build

# Restore database if needed:
mongorestore --uri "$MONGODB_URI" ./backup-xxx/

# Restart:
pm2 start ecosystem.config.js --env production

# Verify:
pm2 logs mass-mailer-backend
```

---

## Success Criteria

After deployment, you should see:

✅ **Emails sending:** Multiple emails per second (not batchy)  
✅ **Per-user pacing:** User A sends, waits 3 min, sends again  
✅ **Domain rotation:** User with 2 domains alternates between them  
✅ **Concurrent users:** Multiple users sending simultaneously  
✅ **CPU usage:** < 60% at normal load  
✅ **Error handling:** Failed sends retry via alternate relay  
✅ **Logging:** Detailed logs for each send attempt

---

**You're ready to deploy! 🚀**

Need any clarification before going live?
