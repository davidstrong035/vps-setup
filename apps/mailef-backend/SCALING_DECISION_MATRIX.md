# Scalability Decision Matrix

## When Do You Need Multiple Servers?

### Current State: Single Server Analysis

Your backend with improvements:

- Per-user pacing (Redis-based) ✅
- Concurrency slots: 5-50 configurable ✅
- Domain rotation per user ✅
- Quota system (daily/global) ✅

**Single server can handle:**

```
workerConcurrency = 5:   ~20 emails/sec    = 72,000/hour
workerConcurrency = 20:  ~40 emails/sec    = 144,000/hour
workerConcurrency = 50:  ~100 emails/sec   = 360,000/hour
```

---

## Decision Tree

### Ask Yourself:

**1. How many users will send simultaneously?**

```
< 10 users:        Single server (50 concurrency) ✅
10-100 users:      Single server (50 concurrency) + monitor
100-500 users:     2-3 servers behind load balancer ⚠️
500+ users:        3+ servers + auto-scaling 🚀
```

**2. How many emails per day?**

```
< 100,000:         Single server (5 concurrency) ✅
100,000-500,000:   Single server (20-50 concurrency) ✅
500,000-2M:        2-3 servers (20-50 each) ⚠️
2M+:               3+ servers + auto-scaling 🚀
```

**3. What are your IP/domain warm-up goals?**

```
Brand new domain:      1 VPC (single server) - warm slowly
1-3 months old:        1-2 VPCs (ease into scale)
6+ months old:         Multiple VPCs (scale aggressively)
```

**4. Do you have multiple ISP connections available?**

```
1 ISP only:           Single or co-located servers
2+ ISPs (different):  Spread servers across ISPs (better deliverability)
```

---

## Recommended Path

### Phase 1: Now (Single Server Optimization)

```
Configuration:
├─ workerConcurrency = 20
├─ customIntervalMinutes = 3
├─ Per-user pacing in Redis
└─ 1 Backend server

Capacity:
├─ 100 concurrent users ✅
├─ 72,000 emails/hour
└─ Monitor CPU/Memory at 500 users
```

### Phase 2: 100-300 Concurrent Users

```
Configuration:
├─ Increase workerConcurrency to 50
├─ Run 2 PM2 instances on same server
└─ Single VPC still

Capacity:
├─ 300 concurrent users ✅
├─ 180,000 emails/hour
└─ Max vertical scaling
```

### Phase 3: 300+ Concurrent Users or >500k emails/day

```
Configuration:
├─ 2-3 backend servers
├─ Load balancer (Nginx or ALB)
├─ Each server: workerConcurrency = 50
└─ Shared Redis/MongoDB

Capacity:
├─ 1,000+ concurrent users ✅
├─ 360,000+ emails/hour
├─ Scale horizontally by adding servers
└─ Linear throughput increase
```

---

## Specific Setup: Your 3 VPCs

### Current Setup

```
VPC #1: Backend + Mail Worker
VPC #2: Backend + Mail Worker
VPC #3: Backend + Mail Worker
```

**Question:** Are these already running separate Node.js instances?

If YES:

```
✅ Just add a load balancer in front
✅ Point all to shared Redis/MongoDB
✅ Done! You have a scalable cluster
```

If NO (all 3 are just raw VPCs):

```
Step 1: Deploy Node.js app to each VPC
Step 2: Configure shared MongoDB/Redis
Step 3: Add load balancer
Step 4: Test load distribution
```

---

## Dispatcher Coordination Across Multiple Servers

Your current code already handles this!

```typescript
// active-campaign-dispatcher.service.ts
const lock = await takeDispatchLock(
  Math.max(dispatchSettings.intervalMs - 250, 1000),
);

if (!lock) {
  isDispatching = false;
  return; // Another server is dispatching, I'll sit out
}
```

With 3 servers, every 5 seconds:

```
Tick 1 (0:00):   Server #1 acquires lock → dispatches → releases
Tick 2 (0:05):   Server #2 acquires lock → dispatches → releases
Tick 3 (0:10):   Server #3 acquires lock → dispatches → releases
Tick 4 (0:15):   Server #1 acquires lock again → dispatches
...repeat...

Result: Each server gets a turn, no duplicates, fair distribution
```

---

## Load Balancer Setup (For 3 VPCs)

### Option A: Nginx (Simple, Free)

Install on separate machine or VPC #1:

```nginx
upstream mailef_backend {
    least_conn;  # Send new connections to server with fewest active
    server vps1.example.com:3000;
    server vps2.example.com:3000;
    server vps3.example.com:3000;
}

server {
    listen 80;
    server_name api.maileff.com;

    location / {
        proxy_pass http://mailef_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

### Option B: HAProxy (More features)

```
global
    maxconn 10000
    mode http

backend mailef_servers
    balance leastconn
    server vps1 vps1.example.com:3000 check inter 5000
    server vps2 vps2.example.com:3000 check inter 5000
    server vps3 vps3.example.com:3000 check inter 5000

frontend mailef_api
    bind *:80
    default_backend mailef_servers
```

### Option C: AWS Application Load Balancer (AWS Native)

```
Create ALB:
├─ Target Group: 3 EC2 instances (port 3000)
├─ Health Check: GET /health (every 30s)
├─ Load Balancing Algorithm: Least Outstanding Requests
└─ SSL: Terminate at ALB (HTTPS to clients, HTTP to backends)
```

---

## Environment Variables Across 3 Servers

All servers must use SAME credentials:

```bash
# VPC #1, #2, #3 all set:
export MONGODB_URI=mongodb://mongo-cluster-host:27017/maileff
export REDIS_URL=redis://redis-cluster-host:6379
export NODE_ENV=production
export ENABLE_ACTIVE_CAMPAIGN_DISPATCHER=true
export MAIL_WORKER_CONCURRENCY=50
```

Different per server (optional):

```bash
# VPC #1: Domain A
export SENDING_DOMAIN=mg.mailef.click
export SMTP_HOST=smtp.vps1.provider.com

# VPC #2: Domain B
export SENDING_DOMAIN=mg.maileff2.click
export SMTP_HOST=smtp.vps2.provider.com

# VPC #3: Domain C
export SENDING_DOMAIN=mg.maileff3.click
export SMTP_HOST=smtp.vps3.provider.com
```

✅ Per-user rotation still works (uses all 3 domains automatically)

---

## Monitoring Multi-Server Setup

### Check Dispatcher Lock Distribution

```bash
redis-cli KEYS "lock:*" | wc -l
# Should see occasional lock acquisitions (every 5 sec)

redis-cli GET "lock:active-campaign-dispatch"
# If empty: dispatcher isn't running
# If present: a server is currently dispatching
```

### Check Per-User Pacing Across Servers

```bash
redis-cli KEYS "user:pace:*" | head -20
# Should see users from ALL servers setting pacing keys

redis-cli GET "user:pace:userId123"
# Should match across all servers (they're checking same Redis)
```

### Monitor Server Queue Distribution

```bash
# On Server #1:
redis-cli LLEN mail-queue

# On Server #2:
redis-cli LLEN mail-queue

# On Server #3:
redis-cli LLEN mail-queue

# Should all see SAME queue length (Redis is shared)
```

---

## Failure Scenarios with Multiple Servers

### Server #1 Dies

```
Load balancer removes it from rotation
Server #2 and #3 continue processing
No job loss (BullMQ handles retries via Redis)
Dispatcher lock prevents duplicate dispatches

Result: System degrades gracefully ✅
```

### Redis Goes Down

```
❌ All servers fail (shared data store failure)
✅ But easy to recover with Redis persistence (RDB/AOF)
✅ Or use Redis Cluster for redundancy
```

### Dispatcher Lock Stuck

```
Redis TTL ensures lock auto-releases after 5 seconds
Next server acquires lock automatically

Result: Self-healing, no manual intervention needed ✅
```

---

## Verdict for 500 Concurrent Users

### Single Server (Current Config)

```
❌ Unlikely to handle smoothly
❌ CPU will max out
❌ Memory pressure high
❌ No redundancy
```

### With 3 Servers Behind Load Balancer

```
✅ Handles 500 users easily
✅ CPU ~40% per server
✅ Memory comfortable (~1GB each)
✅ Redundancy: 2 can fail, 1 survives
✅ Linear scalability: add more servers for more users
✅ All using same domains (rotation works perfectly)
```

**Recommendation: Move to multi-server setup NOW if expecting 500+ concurrent users**

Would you like me to create an Nginx/HAProxy config specific to your 3 VPCs?
