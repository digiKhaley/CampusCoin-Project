import { Router } from "express";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import { getDashboard } from "../controllers/dashboard.controller.js";
import { listNotifications } from "../controllers/notification.controller.js";

const router = Router();
router.use(requireAuth, requireStudent);

router.get("/dashboard", getDashboard);
router.get("/notifications", listNotifications);

export default router;
