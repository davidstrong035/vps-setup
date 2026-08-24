import { Router } from "express";
import { handlePostalWebhook, handleSESWebhook } from "../controllers/webhook.controller";

const router = Router();

// AWS SNS sends raw text/plain body, express.text() handles that
router.post("/ses", handleSESWebhook);
router.post("/postal", handlePostalWebhook);

export default router;
