import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { getUserNextSendTime, getUserSendTimes } from "../controllers/user-domain.controller";
import { listUserDomains } from "../controllers/user-domain.controller";

const router = Router();

router.get("/next-send-time", authenticate, getUserNextSendTime);
router.get("/send-times", authenticate, getUserSendTimes);
router.get("/allowed-domains", authenticate, listUserDomains);

export default router;
