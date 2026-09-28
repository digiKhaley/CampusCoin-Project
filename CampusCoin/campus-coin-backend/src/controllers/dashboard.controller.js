import { prisma } from "../db.js";
import { monthTotals, categoryBreakdown, num, money } from "../utils/aggregates.js";
import { budgetStatus } from "../utils/budgets.js";
import { computeHealth } from "../utils/health.js";
import { computeTips } from "../utils/tips.js";
import { monthStart } from "../utils/dates.js";
import { processRecurring } from "../utils/recurring.js";

// One call powers the whole dashboard screen: balance, health score,
// safe-to-spend, budget vs actual, top category, saving tips, recent activity.
export async function getDashboard(req, res) {
  const user = req.user;
  await processRecurring(user.id);
  const month = monthStart(req.query.month);

  const [totals, budgets, tips, recent, breakdown] = await Promise.all([
    monthTotals(user.id, month),
    budgetStatus(user.id, month),
    computeTips(user.id, month, { limit: 3 }),
    prisma.transaction.findMany({
      where: { userId: user.id, deletedAt: null },
      include: { category: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 5,
    }),
    categoryBreakdown(user.id, { month, type: "expense" }),
  ]);

  const health = computeHealth({
    income: totals.income,
    expense: totals.expense,
    budgets,
    savingsGoal: num(user.monthlySavingsGoal),
    month,
  });

  const goal = num(user.monthlySavingsGoal);
  res.json({
    month: month.toISOString().slice(0, 7),
    greetingName: user.name.split(" ")[0],
    totals,
    health: {
      score: health.score,
      hasData: health.hasData,
      safeToSpendToday: health.safeToSpendToday,
      remainingToSpend: health.remainingToSpend,
      basis: health.basis,
      daysLeft: health.daysLeft,
    },
    savings: goal > 0
      ? { goal, saved: Math.max(0, totals.balance), percent: Math.min(100, Math.round((Math.max(0, totals.balance) / goal) * 100)) }
      : null,
    budgets: budgets.sort((a, b) => b.percentUsed - a.percentUsed).slice(0, 4),
    budgetAlerts: budgets.filter((b) => b.alert).length,
    topCategory: breakdown[0] ? { name: breakdown[0].category, total: breakdown[0].total } : null,
    tips,
    recent,
  });
}
