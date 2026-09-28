import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as c from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const general = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests, try again later" } });
// Mirrors the frontend's admin lockout: 5 failed attempts, then wait 30 seconds.
const adminLimiter = rateLimit({ windowMs: 30 * 1000, limit: 5, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in 30 seconds." } });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many reset requests, try again later" } });

router.use(general);

router.post("/register", c.register);
router.post("/login", c.login);
router.post("/admin/login", adminLimiter, c.adminLogin);
router.post("/logout", requireAuth, c.logout);
router.get("/me", requireAuth, c.me);
router.put("/profile", requireAuth, c.updateProfile);
router.put("/password", requireAuth, c.changePassword);
router.post("/forgot-password", resetLimiter, c.forgotPassword);
router.post("/reset-password", resetLimiter, c.resetPassword);

export default router;
