import { prisma } from "../db.js";
import { budgetStatus } from "../utils/budgets.js";
import { monthStart } from "../utils/dates.js";

// In-app notifications: live budget alerts (near / over limit) + admin announcements.
export async function listNotifications(req, res) {
  const [budgets, announcements] = await Promise.all([
    budgetStatus(req.user.id, monthStart()),
    prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
  ]);

  const alerts = budgets
    .filter((b) => b.alert)
    .map((b) => ({
      id: `budget-${b.id}`,
      type: "budget",
      level: b.alert,
      title: b.alert === "exceeded" ? `${b.category.name} budget exceeded` : `${b.category.name} budget almost used`,
      message:
        b.alert === "exceeded"
          ? `You've spent $${b.spent.toFixed(2)} of your $${b.limitAmount.toFixed(2)} limit.`
          : `You've used ${b.percentUsed}% of your $${b.limitAmount.toFixed(2)} limit.`,
    }));

  const notes = announcements.map((a) => ({
    id: `announcement-${a.id}`,
    type: a.type,
    title: a.title,
    message: a.body,
    createdAt: a.createdAt,
  }));

  res.json({ notifications: [...alerts, ...notes], budgetAlerts: alerts.length });
}
