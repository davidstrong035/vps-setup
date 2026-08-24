"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const webhook_controller_1 = require("../controllers/webhook.controller");
const router = (0, express_1.Router)();
// AWS SNS sends raw text/plain body, express.text() handles that
router.post("/ses", webhook_controller_1.handleSESWebhook);
router.post("/postal", webhook_controller_1.handlePostalWebhook);
exports.default = router;
//# sourceMappingURL=webhook.routes.js.map