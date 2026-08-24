"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const template_controller_1 = require("../controllers/template.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.get("/", template_controller_1.getTemplates);
router.post("/", template_controller_1.createTemplate);
router.get("/:id", template_controller_1.getTemplate);
router.put("/:id", template_controller_1.updateTemplate);
router.delete("/:id", template_controller_1.deleteTemplate);
exports.default = router;
//# sourceMappingURL=template.routes.js.map