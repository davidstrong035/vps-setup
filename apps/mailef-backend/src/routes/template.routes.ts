import { Router } from "express";
import {
  getTemplates,
  createTemplate,
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from "../controllers/template.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getTemplates);
router.post("/", createTemplate);
router.get("/:id", getTemplate);
router.put("/:id", updateTemplate);
router.delete("/:id", deleteTemplate);

export default router;
