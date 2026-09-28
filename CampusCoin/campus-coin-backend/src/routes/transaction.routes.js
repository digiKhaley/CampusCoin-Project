import { Router } from "express";
import multer from "multer";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import * as c from "../controllers/transaction.controller.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const router = Router();
router.use(requireAuth, requireStudent);

// Fixed paths first, then /:id
router.get("/", c.listTransactions);
router.get("/summary", c.summary);
router.get("/recurring", c.listRecurring);
router.post("/", c.createTransaction);
router.post("/import", upload.single("file"), c.importCsv);
router.get("/:id/history", c.transactionHistory);
router.post("/:id/restore", c.restoreTransaction);
router.put("/:id", c.updateTransaction);
router.delete("/:id", c.deleteTransaction);

export default router;
