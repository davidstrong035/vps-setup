import { Router } from "express";
import {
  register,
  login,
  getMe,
  getMyEmailAllocation,
  getMyEmailActivity,
  getMyEmailAllocationHistory,
  getMyMailSettings,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", authenticate, getMe);
router.get("/me/mail-settings", authenticate, getMyMailSettings);
router.get("/me/email-package", authenticate, getMyEmailAllocation);
router.get("/me/email-packages", authenticate, getMyEmailAllocationHistory);
router.get("/me/email-activity", authenticate, getMyEmailActivity);

export default router;
