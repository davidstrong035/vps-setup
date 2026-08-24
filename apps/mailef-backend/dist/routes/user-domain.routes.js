"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const user_domain_controller_1 = require("../controllers/user-domain.controller");
const user_domain_controller_2 = require("../controllers/user-domain.controller");
const router = (0, express_1.Router)();
router.get("/next-send-time", auth_middleware_1.authenticate, user_domain_controller_1.getUserNextSendTime);
router.get("/send-times", auth_middleware_1.authenticate, user_domain_controller_1.getUserSendTimes);
router.get("/allowed-domains", auth_middleware_1.authenticate, user_domain_controller_2.listUserDomains);
exports.default = router;
//# sourceMappingURL=user-domain.routes.js.map