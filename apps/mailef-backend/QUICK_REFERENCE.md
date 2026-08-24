# Quick Reference Card

## Your Setup

```
┌─────────────────────────────────────┐
│   Backend Server (VPS #1)           │
├─────────────────────────────────────┤
│ ├─ Node.js App                      │
│ ├─ Mail Worker (50 concurrent)      │
│ ├─ Campaign Dispatcher              │
│ └─ Per-user pacing (Redis)          │
└─────────────────────────────────────┘
        │              │
        ▼              ▼
   Postal #1      Postal #2
   (SMTP A)       (SMTP B)
```

---

## Configuration NOW

```bash
MAIL_WORKER_CONCURRENCY=50
CUSTOM_INTERVAL_MINUTES=3
ENABLE_ACTIVE_CAMPAIGN_DISPATCHER=true
```

---

## Throughput

| Setup             | Emails/sec | Emails/day | Users   |
| ----------------- | ---------- | ---------- | ------- |
| Current (you now) | 100        | 8.6M       | 100-200 |
| +VPS #2           | 300        | 26M        | 500+    |
| +VPS #3           | 500        | 43M        | 1000+   |

---

## How It Works

```
User sends campaign
    ↓
Dispatcher queues 100 recipients
    ↓
Worker processes jobs (50 parallel):
├─ Check per-user pacing (Redis)
├─ Select domain (rotate)
├─ Send via Postal relay
├─ Mark as "sent"
└─ Update pacing timer
    ↓
Multiple users send SIMULTANEOUSLY
(Each respects their 3-minute interval)
```

---

## Key Features

✅ Per-user pacing (no global bottleneck)  
✅ Domain rotation (balance load)  
✅ Postal failover (automatic retry)  
✅ Daily reset (automatic cron)  
✅ Error tracking (DLQ with details)  
✅ Multi-tenant (all isolated per-user)

---

## Monitoring Commands

```bash
# Queue size
redis-cli LLEN mail-queue

# Active users (pacing)
redis-cli KEYS "user:pace:*" | wc -l

# Worker status
pm2 list

# Live logs
pm2 logs mass-mailer-backend

# CPU/Memory
top | grep node
```

---

## Deployment

```bash
npm run build
pm2 stop ecosystem.config.js
# (backup data)
git pull
npm run build
pm2 start ecosystem.config.js --env production
pm2 logs mass-mailer-backend
```

---

## When to Add VPS #2

- [ ] CPU consistently > 75%
- [ ] Queue regularly > 10,000 jobs
- [ ] Need 500+ concurrent users
- [ ] Want redundancy

Then follow: LOAD_BALANCER_SCALING.md

---

## Emergency Troubleshooting

| Issue             | Check                            |
| ----------------- | -------------------------------- |
| No emails sending | `pm2 status`                     |
| Stuck queue       | `redis-cli LLEN mail-queue`      |
| High CPU          | Reduce `MAIL_WORKER_CONCURRENCY` |
| Postal failures   | Check relay connectivity         |
| Redis down        | `redis-cli ping`                 |

---

## Documentation Files

- **CURRENT_SETUP_GUIDE.md** ← Start here
- **DEPLOYMENT_CHECKLIST.md** ← Deploy from here
- **SCALABILITY_FIX_SUMMARY.md** ← Understand the fix
- **LOAD_BALANCER_SCALING.md** ← When adding VPS #2
- **COMPLETE_SUMMARY.md** ← Full overview

---

## Quick Decision Tree

```
"Is my server ready to deploy?"
→ Build successful? YES → DEPLOY
→ Build failed? → Check errors in console

"Should I add VPS #2?"
→ CPU > 75%? YES → Plan migration
→ Users > 500? YES → Plan migration
→ Else? WAIT → Monitor & collect data

"How do I scale?"
→ Increase concurrency? (cheap, faster)
→ Add VPS #2? (scales linearly)
→ Follow LOAD_BALANCER_SCALING.md
```

---

## Success Metrics (After Deploy)

- [ ] Emails sending continuously (not batchy)
- [ ] CPU < 60% at normal load
- [ ] Queue draining to ~0 by end of day
- [ ] Per-user pacing working (check Redis keys)
- [ ] Domain rotation alternating (check logs)
- [ ] Postal relays active (both responsive)
- [ ] Error rate < 1%

---

**You're ready! 🚀**

Deploy to VPS #1 and monitor.
When you hit limits, refer to scaling docs.
Linear scaling: add servers = add capacity.

Good luck!
