import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { listUserDomains } from "../controllers/user-domain.controller";

const router = Router();

// Users can only view the domains assigned to them by the admin
router.get("/domains", authenticate, listUserDomains);

export default router;
