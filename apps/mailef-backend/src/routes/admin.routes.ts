import { Router } from "express";
import {
  createAdmin,
  createSmtpRelayForAdmin,
  createUserEmailAllocation,
  deleteSmtpRelayForAdmin,
  suspendUserEmailAllocation,
  getAuditLogs,
  getAdminOverview,
  getGlobalQuotaUsageHandler,
  getGlobalSendLimits,
  getPlatformDispatchSettingsForAdmin,
  getPlatformMailSettingsForAdmin,
  getSmtpRelaysForAdmin,
  testPlatformMailSettingsForAdmin,
  getUserEmailAllocation,
  getUserStats,
  getUserSendLimits,
  getUsers,
  setSmtpRelayActiveStateForAdmin,
  setSmtpRelayArchivedStateForAdmin,
  updateGlobalSendLimits,
  updatePlatformDispatchSettingsForAdmin,
  updatePlatformMailSettingsForAdmin,
  updateSmtpRelayForAdmin,
  updateUserEmailAllocation,
  updateUserSendLimits,
  updateUserAccess,
  resetUserPassword,
  getUserAssignedDomains,
  updateUserAssignedDomains,
  adminDeletePlatformDomain,
  reconcileUserAllocation,
  extendUserEmailAllocation,
  adminReleaseCampaignPause,
  adminPauseCampaign,
  adminPauseAllUserCampaigns,
  adminListPendingUserDomains,
  adminVerifyUserDomain,
  getSystemHealthHandler,
  adminRecoverCampaign,
} from "../controllers/admin.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate, authorizeRoles("admin", "super_admin"));

router.get("/overview", getAdminOverview);
router.get("/audit-logs", getAuditLogs);
router.get("/mail-settings", getPlatformMailSettingsForAdmin);
router.post("/mail-settings/test", testPlatformMailSettingsForAdmin);
router.put("/mail-settings", updatePlatformMailSettingsForAdmin);
router.get("/smtp-relays", getSmtpRelaysForAdmin);
router.post("/smtp-relays", createSmtpRelayForAdmin);
router.put("/smtp-relays/:id", updateSmtpRelayForAdmin);
router.post("/smtp-relays/:id/active", setSmtpRelayActiveStateForAdmin);
router.post("/smtp-relays/:id/archive", setSmtpRelayArchivedStateForAdmin);
router.delete("/smtp-relays/:id", deleteSmtpRelayForAdmin);
router.get("/dispatch-settings", getPlatformDispatchSettingsForAdmin);
router.put("/dispatch-settings", updatePlatformDispatchSettingsForAdmin);
router.get("/rate-limits/global", getGlobalSendLimits);
router.get("/rate-limits/global/usage", getGlobalQuotaUsageHandler);
router.put("/rate-limits/global", updateGlobalSendLimits);
router.get("/users", getUsers);
router.get("/users/:id/stats", getUserStats);
router.get("/users/:id/email-package", getUserEmailAllocation);
router.post("/users/:id/email-package", createUserEmailAllocation);
router.put("/users/:id/email-package/:allocationId", updateUserEmailAllocation);
router.put("/users/:id/email-package/:allocationId/suspend", suspendUserEmailAllocation);
router.put("/users/:id/email-package/:allocationId/extend", extendUserEmailAllocation);
router.get("/users/:id/rate-limits", getUserSendLimits);
router.put("/users/:id/rate-limits", updateUserSendLimits);
router.patch("/users/:id", updateUserAccess);
router.post("/users/:id/reset-password", resetUserPassword);
router.get("/users/:id/domains", getUserAssignedDomains);
router.put("/users/:id/domains", updateUserAssignedDomains);
router.delete("/platform-domains/:id", adminDeletePlatformDomain);
router.post("/users/:id/email-package/reconcile", reconcileUserAllocation);
router.post("/campaigns/:id/release-pause", adminReleaseCampaignPause);
router.post("/campaigns/:id/pause", adminPauseCampaign);
router.post("/campaigns/:id/recover", adminRecoverCampaign);
router.post("/users/:id/campaigns/pause-all", adminPauseAllUserCampaigns);
router.get("/user-domains/pending", adminListPendingUserDomains);
router.post("/user-domains/:id/verify", adminVerifyUserDomain);
router.get("/system/health", getSystemHealthHandler);
router.post("/admins", createAdmin);


export default router;