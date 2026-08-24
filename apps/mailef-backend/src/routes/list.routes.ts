import { Router } from "express";
import {
  getLists,
  createList,
  getList,
  updateList,
  deleteList,
} from "../controllers/list.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getLists);
router.post("/", createList);
router.get("/:id", getList);
router.put("/:id", updateList);
router.delete("/:id", deleteList);

export default router;
