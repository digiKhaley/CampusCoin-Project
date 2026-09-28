import { Router } from "express";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import * as c from "../controllers/budget.controller.js";

const router = Router();
router.use(requireAuth, requireStudent);

router.get("/", c.listBudgets);
router.post("/", c.upsertBudget);
router.post("/copy-previous", c.copyBudgets);
router.delete("/:id", c.deleteBudget);

export default router;
