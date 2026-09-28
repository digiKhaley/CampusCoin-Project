import { Router } from "express";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import * as c from "../controllers/ai.controller.js";

const router = Router();
router.use(requireAuth, requireStudent);

router.post("/categorize", c.suggestCategoryHandler);
router.post("/categorize/batch", c.suggestBatch);
router.post("/categorize/correct", c.correctCategory);
router.post("/ask", c.ask);

router.get("/insights", c.listInsights);
router.post("/insights/generate", c.generateInsight);
router.patch("/insights/:id", c.updateInsight);

router.get("/tips", c.listTips);
router.patch("/tips/:categoryId", c.updateTipState);

export default router;
