"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post("/register", auth_controller_1.register);
router.post("/login", auth_controller_1.login);
router.post("/forgot-password", auth_controller_1.forgotPassword);
router.post("/reset-password", auth_controller_1.resetPassword);
router.get("/me", auth_middleware_1.authenticate, auth_controller_1.getMe);
router.get("/me/mail-settings", auth_middleware_1.authenticate, auth_controller_1.getMyMailSettings);
router.get("/me/email-package", auth_middleware_1.authenticate, auth_controller_1.getMyEmailAllocation);
router.get("/me/email-packages", auth_middleware_1.authenticate, auth_controller_1.getMyEmailAllocationHistory);
router.get("/me/email-activity", auth_middleware_1.authenticate, auth_controller_1.getMyEmailActivity);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map