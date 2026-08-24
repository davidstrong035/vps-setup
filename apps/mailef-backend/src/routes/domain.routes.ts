
import { Router } from 'express';
import {
  getAllDomains,
  createDomain,
  updateDomain,
  deleteDomain,
  resetDomainUsage,
  setBlocklistStatus,
  setCooldown,
  setDefaultDomain,
  setReputationScore,
  resetBounceComplaint,
} from '../controllers/domain.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';


const router = Router();



// CRUD routes for sending domains
router.get('/', authenticate, authorizeRoles('admin', 'super_admin'), getAllDomains);
router.post('/', authenticate, authorizeRoles('admin', 'super_admin'), createDomain);
router.put('/:id', authenticate, authorizeRoles('admin', 'super_admin'), updateDomain);
router.delete('/:id', authenticate, authorizeRoles('admin', 'super_admin'), deleteDomain);
router.post('/:id/reset-usage', authenticate, authorizeRoles('admin', 'super_admin'), resetDomainUsage);

// Admin controls
router.post('/:id/blocklist', authenticate, authorizeRoles('admin', 'super_admin'), setBlocklistStatus);
router.post('/:id/cooldown', authenticate, authorizeRoles('admin', 'super_admin'), setCooldown);
router.post('/:id/default', authenticate, authorizeRoles('admin', 'super_admin'), setDefaultDomain);
router.post('/:id/reputation', authenticate, authorizeRoles('admin', 'super_admin'), setReputationScore);
router.post('/:id/reset-bounce-complaint', authenticate, authorizeRoles('admin', 'super_admin'), resetBounceComplaint);

export default router;
