"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const user_domain_controller_1 = require("../controllers/user-domain.controller");
const router = (0, express_1.Router)();
// Users can only view the domains assigned to them by the admin
router.get("/domains", auth_middleware_1.authenticate, user_domain_controller_1.listUserDomains);
exports.default = router;
//# sourceMappingURL=sender.routes.js.map