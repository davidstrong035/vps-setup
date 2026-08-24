import { Router } from "express";
import {
  getCampaigns,
  getMyQueueOverview,
  createCampaign,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  scheduleCampaign,
  getCampaignStats,
  pauseUserCampaign,
  cancelUserCampaign,
} from "../controllers/campaign.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getCampaigns);
router.get("/queue-overview", getMyQueueOverview);
router.post("/", createCampaign);
router.get("/:id", getCampaign);
router.put("/:id", updateCampaign);
router.delete("/:id", deleteCampaign);
router.post("/:id/send", sendCampaign);
router.post("/:id/schedule", scheduleCampaign);
router.post("/:id/pause", pauseUserCampaign);
router.post("/:id/cancel", cancelUserCampaign);
router.get("/:id/stats", getCampaignStats);

export default router;
