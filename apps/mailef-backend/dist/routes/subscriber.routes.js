"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const subscriber_controller_1 = require("../controllers/subscriber.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// public unsubscribe link
router.get("/unsubscribe", subscriber_controller_1.unsubscribe);
// protected routes
router.get("/:listId/subscribers", auth_middleware_1.authenticate, subscriber_controller_1.getSubscribers);
router.post("/:listId/subscribers", auth_middleware_1.authenticate, subscriber_controller_1.addSubscriber);
router.post("/:listId/subscribers/import/initiate", auth_middleware_1.authenticate, subscriber_controller_1.initiateS3SubscriberImport);
router.post("/:listId/subscribers/import/complete", auth_middleware_1.authenticate, subscriber_controller_1.completeS3SubscriberImport);
router.post("/:listId/subscribers/import", auth_middleware_1.authenticate, subscriber_controller_1.importSubscribers);
router.delete("/:listId/subscribers/:subscriberId", auth_middleware_1.authenticate, subscriber_controller_1.deleteSubscriber);
exports.default = router;
//# sourceMappingURL=subscriber.routes.js.map