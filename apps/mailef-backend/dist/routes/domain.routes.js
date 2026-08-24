"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const domain_controller_1 = require("../controllers/domain.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// CRUD routes for sending domains
router.get('/', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.getAllDomains);
router.post('/', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.createDomain);
router.put('/:id', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.updateDomain);
router.delete('/:id', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.deleteDomain);
router.post('/:id/reset-usage', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.resetDomainUsage);
// Admin controls
router.post('/:id/blocklist', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.setBlocklistStatus);
router.post('/:id/cooldown', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.setCooldown);
router.post('/:id/default', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.setDefaultDomain);
router.post('/:id/reputation', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.setReputationScore);
router.post('/:id/reset-bounce-complaint', auth_middleware_1.authenticate, (0, auth_middleware_1.authorizeRoles)('admin', 'super_admin'), domain_controller_1.resetBounceComplaint);
exports.default = router;
//# sourceMappingURL=domain.routes.js.map