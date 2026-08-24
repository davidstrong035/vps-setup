import { Router } from "express";
import { mailDeadLetterQueue } from "../queue/mail.dead-letter.queue";

const router = Router();

// GET /admin/dead-letter-jobs
router.get("/dead-letter-jobs", async (req, res) => {
  try {
    // Only allow admin/super_admin (add your auth middleware as needed)
    // Example: if (!req.user || req.user.role !== 'admin') return res.status(403).send('Forbidden');
    const jobs = await mailDeadLetterQueue.getJobs(["waiting", "active", "delayed", "failed", "completed"]);
    const formatted = jobs.map((job) => ({
      id: job.id,
      ...job.data,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
    }));
    res.json({ jobs: formatted });
  } catch (err) {
    const errorMsg = typeof err === "object" && err && "message" in err ? (err as any).message : String(err);
    res.status(500).json({ message: "Failed to fetch dead letter jobs", error: errorMsg });
  }
});

// POST /admin/dead-letter-jobs/:id/retry
router.post("/dead-letter-jobs/:id/retry", async (req, res) => {
  try {
    const job = await mailDeadLetterQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    await job.remove();
    res.json({ message: "Job removed from DLQ. Implement requeue logic as needed." });
  } catch (err) {
    const errorMsg = typeof err === "object" && err && "message" in err ? (err as any).message : String(err);
    res.status(500).json({ message: "Failed to retry dead letter job", error: errorMsg });
  }
});

// DELETE /admin/dead-letter-jobs  — bulk clear all jobs from the DLQ
router.delete("/dead-letter-jobs", async (_req, res) => {
  try {
    await mailDeadLetterQueue.obliterate({ force: true });
    res.json({ message: "Dead letter queue cleared." });
  } catch (err) {
    const errorMsg = typeof err === "object" && err && "message" in err ? (err as any).message : String(err);
    res.status(500).json({ message: "Failed to clear dead letter queue", error: errorMsg });
  }
});

export default router;
