import { Router } from "express";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import * as c from "../controllers/split.controller.js";

const router = Router();
router.use(requireAuth, requireStudent);

router.get("/", c.listSplits);
router.post("/", c.createSplit);
router.patch("/:id/settle", c.setSettled);
router.delete("/:id", c.deleteSplit);

export default router;
