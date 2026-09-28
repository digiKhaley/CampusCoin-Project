import "dotenv/config";
import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import authRoutes from "./routes/auth.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import transactionRoutes from "./routes/transaction.routes.js";
import budgetRoutes from "./routes/budget.routes.js";
import goalRoutes from "./routes/goal.routes.js";
import splitRoutes from "./routes/split.routes.js";
import reportRoutes from "./routes/report.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { notFound, errorHandler } from "./middleware/errors.js";
import { processRecurring } from "./utils/recurring.js";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error("JWT_SECRET must be set to a long random string (16+ characters). See .env.example");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1); // correct client IPs behind Render/Railway/Vercel for rate limiting

app.use(helmet());

const origins = (process.env.CLIENT_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ limit: "100kb" }));

const health = (req, res) => res.json({ ok: true, service: "campus-coin-api", time: new Date().toISOString() });
app.get("/health", health);
app.get("/api/health", health);

app.use("/api/auth", authRoutes);
app.use("/api", dashboardRoutes); // /api/dashboard, /api/notifications
app.use("/api/categories", categoryRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/goals", goalRoutes);
app.use("/api/splits", splitRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;

if (!process.env.VERCEL) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Campus Coin API listening on http://localhost:${port}`);
    // Materialise due recurring transactions now and hourly.
    processRecurring().catch((e) => console.error("recurring job:", e.message));
    setInterval(() => processRecurring().catch((e) => console.error("recurring job:", e.message)), 60 * 60 * 1000).unref();
  });
}
