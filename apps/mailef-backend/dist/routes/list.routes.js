"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const list_controller_1 = require("../controllers/list.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.get("/", list_controller_1.getLists);
router.post("/", list_controller_1.createList);
router.get("/:id", list_controller_1.getList);
router.put("/:id", list_controller_1.updateList);
router.delete("/:id", list_controller_1.deleteList);
exports.default = router;
//# sourceMappingURL=list.routes.js.map