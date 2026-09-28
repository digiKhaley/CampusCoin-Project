import { Router } from "express";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import * as c from "../controllers/category.controller.js";

const router = Router();
router.use(requireAuth, requireStudent);

router.get("/", c.listCategories);
router.post("/", c.createCategory);
router.put("/:id", c.updateCategory);
router.delete("/:id", c.deleteCategory);

export default router;
