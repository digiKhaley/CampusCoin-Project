import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import * as c from "../controllers/admin.controller.js";

const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/stats", c.stats);

router.get("/users", c.listUsers);
router.patch("/users/:id", c.setUserDisabled);
router.post("/users/:id/reset-password", c.resetUserPassword);

router.get("/default-categories", c.listDefaultCategories);
router.post("/default-categories", c.createDefaultCategory);
router.put("/default-categories/:id", c.updateDefaultCategory);
router.delete("/default-categories/:id", c.deleteDefaultCategory);

router.get("/announcements", c.listAnnouncements);
router.post("/announcements", c.createAnnouncement);
router.delete("/announcements/:id", c.deleteAnnouncement);

router.get("/activity-log", c.activityLog);

export default router;
