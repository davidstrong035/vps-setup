# Scaling Architecture: Multiple VPCs + Load Balancer

## Current Architecture vs. Scalable Architecture

### Current (Single Server)

```
┌─────────────────────────────┐
│  Your Mailef Backend Server │
│  ├─ Mail Worker (concurrency=20)
│  ├─ Active Campaign Dispatcher
│  └─ Redis (shared)
│
└─ Bottleneck: Single worker process
   Max throughput: ~20 concurrent sends
```

### Truly Scalable (Multiple Servers + Load Balancer)

```
                    ┌──────────────────────────┐
                    │   Load Balancer (NGinx)  │
                    │   or AWS ALB/NLB         │
                    └──────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
        ┌───────▼────────┐ ┌──▼─────────┐ ┌──▼─────────┐
        │   Backend #1   │ │ Backend #2 │ │ Backend #3 │
        │ (VPC/VPS #1)   │ │(VPC/VPS #2)│ │(VPC/VPS #3)│
        ├─ Worker x5    │ ├─ Worker x5 │ ├─ Worker x5 │
        ├─ Dispatcher   │ ├─ Dispatcher│ ├─ Dispatcher│
        └─────┬──────────┘ └──┬────────┘ └──┬────────┘
              │                │             │
              └────────────────┼─────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Redis Cluster     │
                    │ (Shared across all) │
                    └─────────────────────┘
```

---

## Why Multiple Servers?

### Bottlenecks to Consider:

| Component              | Single Server               | Multiple Servers                |
| ---------------------- | --------------------------- | ------------------------------- |
| **Worker Concurrency** | Max ~20-50 concurrent sends | 5 servers × 50 = 250 concurrent |
| **CPU**                | 100% used at peak           | Distributed across servers      |
| **Memory**             | Limited by single machine   | Scales with instances           |
| **Network I/O**        | Single network card         | Multiple network connections    |
| **Redis Load**         | All queries hit one Redis   | Distributed via Lua scripts     |

### Example: 500 Users Sending Simultaneously

**Single Server:**

```
workerConcurrency = 50
Throughput = 50 emails/sec
250,000 emails ÷ 50 = 5,000 seconds = 1.4 hours

CPU: ~80-90% (worker bottleneck)
Memory: ~2GB (job queue in RAM)
Network: Fully utilized
```

**3 Servers (Behind Load Balancer):**

```
3 servers × 50 concurrency = 150 emails/sec
250,000 emails ÷ 150 = 1,667 seconds = 28 minutes ✅

Per-server CPU: ~30% (comfortable headroom)
Per-server Memory: ~700MB each (distributed)
Network: Spread across 3 NICs
```

---

## Architecture with Multiple VPCs

Your setup (which is perfect):

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Infrastructure                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  VPC #1 (VPS #1)          VPC #2 (VPS #2)       VPC #3      │
│  ┌────────────────┐       ┌────────────────┐    ┌──────────┐│
│  │ Backend Server │       │ Backend Server │    │ Backend  ││
│  │ (Node.js)      │       │ (Node.js)      │    │(Node.js) ││
│  ├─ Worker        │       ├─ Worker        │    ├─ Worker  ││
│  ├─ Dispatcher    │       ├─ Dispatcher    │    ├─ Dispatch││
│  ├─ Domain A      │       ├─ Domain B      │    ├─ Domain C││
│  └─ SMTP Relay 1  │       └─ SMTP Relay 2  │    └─ Relay 3 ││
│                   │                         │                 │
│  Send via:        │       Send via:         │   Send via:    │
│  IP/domain A      │       IP/domain B       │   IP/domain C  │
│  (Low IP age)     │       (Different ISP)   │  (Warm domain) │
│                   │                         │                 │
└────────────────────────────────────────────────────────────┘
                        ▲
                        │
                   Shared Layer
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    ┌────▼─────┐   ┌───▼────┐   ┌───▼─────┐
    │ Redis    │   │MongoDB │   │ S3 List │
    │(shared)  │   │(shared)│   │ Storage │
    └──────────┘   └────────┘   └─────────┘
```

---

## How Load Balancer + Multiple Servers Work

### 1. User Campaign Dispatch Flow (Round-Robin)

```
User creates campaign → API request hits load balancer
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              Backend #1  Backend #2  Backend #3
              (round-robin)

Server #1: Saves campaign to MongoDB (shared)
           Returns: campaign_id

User hits "Send" button → API calls /campaign/:id/send
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              Backend #1  Backend #2  Backend #3

Server #2: Dispatches recipients to mail-queue (shared Redis)
           Returns: 100 recipients queued

Mail-queue now has 100 jobs from same campaign
```

### 2. Job Processing Across Servers

```
Mail-Queue (Redis, shared):
├─ Job 1 (User A, recipient1)
├─ Job 2 (User B, recipient1)
├─ Job 3 (User A, recipient2)
├─ Job 4 (User C, recipient1)
├─ Job 5 (User B, recipient2)
└─ ... 95 more jobs

Worker instances (3 servers, 5 concurrency each):
Server #1 Worker: Grabs Job 1 → Send via Domain A → Release slot
                  Grabs Job 4 → Send via Domain C → Release slot
                  Grabs Job 7 → ...

Server #2 Worker: Grabs Job 2 → Send via Domain B → Release slot
                  Grabs Job 5 → Send via Domain B → Release slot
                  Grabs Job 8 → ...

Server #3 Worker: Grabs Job 3 → Send via Domain A → Release slot
                  Grabs Job 6 → Send via Domain B → Release slot
                  Grabs Job 9 → ...

Redis Pacing (Per-User Tracking):
├─ user:pace:UserA → timestamp (next allowed send for User A)
├─ user:pace:UserB → timestamp
└─ user:pace:UserC → timestamp

All servers check SAME Redis keys → all respect same pacing
```

---

## Per-User Pacing with Multiple Servers

**Key Point:** Redis pacing keys are shared across ALL servers.

```
Server #1 sends email for User A at 0:00
├─ Sets Redis: user:pace:UserA = 0:03:00 (next allowed send)

Server #2 picks up next User A job at 0:00:30
├─ Checks Redis: user:pace:UserA = 0:03:00
├─ Calculates: 0:03:00 - 0:00:30 = 2:30 wait
├─ Sleeps 2:30
├─ At 0:03:00, sends User A's second email
└─ Updates Redis: user:pace:UserA = 0:06:00

Server #3 picks up next User A job at 0:02:00
├─ Checks Redis: user:pace:UserA = 0:03:00
├─ Calculates: 0:03:00 - 0:02:00 = 1:00 wait
├─ Sleeps 1:00
├─ At 0:03:00, would send BUT User A slot is taken by Server #2
├─ So Server #3 grabs different user's job instead
└─ User A gets next slot after Server #2 finishes

Result: User A still respects 3-minute pacing
        But multiple servers can process OTHER users simultaneously
```

---

## Dispatcher Coordination (Important!)

With multiple dispatcher instances, you need to **prevent duplicate queueing**.

### Current Problem:

```
Dispatcher #1 (Server #1): Finds Campaign X
                          ├─ Locks it (Redis lock)
                          ├─ Queues 100 recipients
                          └─ Releases lock

Dispatcher #2 (Server #2): Also finds Campaign X
                          ├─ Tries to lock (blocked by #1's lock)
                          ├─ Waits
                          └─ After lock released, queues SAME 100 (DUPLICATE!)
```

### Solution: Redis Distributed Lock (Already Implemented!)

Your code already has this:

```typescript
// src/services/active-campaign-dispatcher.service.ts
const lock = await takeDispatchLock(
  Math.max(dispatchSettings.intervalMs - 250, 1000),
);

if (!lock) {
  isDispatching = false;
  return; // Another instance is dispatching, skip this tick
}
```

✅ **This works perfectly with multiple servers!**

Each dispatcher tick, only ONE instance acquires the lock and dispatches.
Others skip that tick. Next tick, a different instance might acquire it.

---

## Setup: Multiple Servers + Load Balancer

### Option 1: Manual Setup (3 VPSs)

**VPS #1:**

```bash
cd /home/user/maileff-backend
npm install
npm run build
MONGODB_URI=mongodb://shared-host:27017/maileff \
REDIS_URL=redis://shared-redis-host:6379 \
SMTP_HOST=smtp.vsp1.com \
MAIL_WORKER_CONCURRENCY=50 \
pm2 start ecosystem.config.js --env production
```

**VPS #2:**

```bash
# Same code, same MongoDB/Redis, different SMTP relay
MONGODB_URI=mongodb://shared-host:27017/maileff \
REDIS_URL=redis://shared-redis-host:6379 \
SMTP_HOST=smtp.vps2.com \
pm2 start ecosystem.config.js --env production
```

**VPS #3:**

```bash
# Same again
MONGODB_URI=mongodb://shared-host:27017/maileff \
REDIS_URL=redis://shared-redis-host:6379 \
SMTP_HOST=smtp.vps3.com \
pm2 start ecosystem.config.js --env production
```

### Option 2: Load Balancer (Nginx on Separate Machine)

```nginx
upstream backend {
    server vps1.example.com:3000 weight=1;
    server vps2.example.com:3000 weight=1;
    server vps3.example.com:3000 weight=1;
}

server {
    listen 80;
    server_name api.maileff.com;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

### Option 3: AWS (Recommended for Production)

```yaml
# AWS Load Balancer + Auto Scaling
Components:
├─ Application Load Balancer (ALB)
│  └─ Target Group: 3+ EC2 instances running Node.js
├─ RDS (MongoDB) - Multi-AZ
├─ ElastiCache (Redis) - Multi-AZ
└─ Auto Scaling Group (min: 3, max: 10 instances)
```

---

## Throughput Scaling

### Single Server

```
workerConcurrency = 50
Mail send time = 500ms
Throughput = 50 concurrent ÷ 0.5s = 100 emails/sec = 360,000/hour
```

### 3 Servers Behind Load Balancer

```
3 × 50 concurrency = 150 concurrent sends
Throughput = 150 ÷ 0.5s = 300 emails/sec = 1,080,000/hour ✅
```

### 10 Servers (Auto-Scaling Peak)

```
10 × 50 concurrency = 500 concurrent sends
Throughput = 500 ÷ 0.5s = 1,000 emails/sec = 3,600,000/hour ✅✅✅
```

---

## Your Setup with 3 VPCs

Perfect for this exact scenario:

```
┌────────────────────────────────────────────────────┐
│         Your Maileff Infrastructure                 │
├────────────────────────────────────────────────────┤
│                                                      │
│ Load Balancer / Nginx                              │
│ (Routes /api requests round-robin)                 │
│         │                                           │
│    ┌────┼────┬────────┐                            │
│    ▼    ▼    ▼        ▼                            │
│ VPS#1 VPS#2 VPS#3 VPS#4(Optional)                 │
│ ├─ Backend Server                                 │
│ ├─ Node.js + PM2                                  │
│ ├─ Mail Worker (concurrency=50)                   │
│ ├─ Campaign Dispatcher                            │
│ └─ Domain A/B/C (rotate per user)                 │
│                                                     │
└────────────────────────────────────────────────────┘
           │                │
      ┌────▼────────────────▼──┐
      │  Shared Services        │
      ├─ MongoDB (Cluster)     │
      ├─ Redis (Cluster)       │
      ├─ S3 (Email Lists)      │
      └─────────────────────────┘
```

---

## Summary: Truly Scalable Architecture

✅ **Multiple VPCs:** Each runs independent backend + mail worker  
✅ **Shared Redis:** Pacing, quotas, locks are global  
✅ **Shared MongoDB:** Campaigns, users, domains shared  
✅ **Load Balancer:** Routes API requests round-robin  
✅ **Per-User Pacing:** Enforced via Redis, respected across all servers  
✅ **Dispatcher Lock:** Only one instance dispatches per tick (no duplicates)

**Result:**

- 500 users sending = handled in minutes, not hours
- 3 VPCs × 50 concurrency = 150 parallel sends
- Linear scaling: add VPC = add 50 more concurrent slots
- No single point of failure (all servers identical)

---

## Do You Need This Now?

For current load (unknown), you might be fine with:

- 1 backend server with 20-50 concurrency
- Vertical scaling (increase CPU/RAM first)

Later, when hitting limits:

- Add 2nd VPS behind load balancer
- Use Redis/MongoDB clusters (if not already)
- Enable auto-scaling (if on cloud)

**Want me to show you how to set up the load balancer configuration?**
