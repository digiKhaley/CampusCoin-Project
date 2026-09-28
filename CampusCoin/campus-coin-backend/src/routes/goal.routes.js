import { Router } from "express";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import * as c from "../controllers/goal.controller.js";

const router = Router();
router.use(requireAuth, requireStudent);

router.get("/", c.listGoals);
router.post("/", c.createGoal);
router.put("/:id", c.updateGoal);
router.post("/:id/contribute", c.contribute);
router.delete("/:id", c.deleteGoal);

export default router;
