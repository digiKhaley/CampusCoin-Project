import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import * as c from "../controllers/report.controller.js";

const shareLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many emails sent, try again later" } });

const router = Router();
router.use(requireAuth, requireStudent);

router.get("/category-breakdown", c.getCategoryBreakdown);
router.get("/income-vs-expense", c.getIncomeVsExpense);
router.get("/period-summary", c.getPeriodSummary);
router.get("/forecast", c.getForecast);
router.get("/export.pdf", c.exportPdf);
router.post("/share-email", shareLimiter, c.shareByEmail);

export default router;
