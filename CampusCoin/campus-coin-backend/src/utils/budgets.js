import { prisma } from "../db.js";
import { categoryTotals, num, money } from "./aggregates.js";

// Alert at 90% of the limit ("nears") and 100%+ ("exceeds") — SRS 1.6.
export const ALERT_THRESHOLD = 0.9;

export async function budgetStatus(userId, month) {
  const budgets = await prisma.budget.findMany({
    where: { userId, month },
    include: { category: true },
  });
  if (!budgets.length) return [];

  const spend = await categoryTotals(userId, month, "expense");

  return budgets.map((b) => {
    const spent = money(spend.get(b.categoryId) || 0);
    const limit = num(b.limitAmount);
    const ratio = limit > 0 ? spent / limit : 0;
    return {
      id: b.id,
      categoryId: b.categoryId,
      category: b.category,
      month: b.month,
      limitAmount: limit,
      spent,
      remaining: money(limit - spent),
      percentUsed: Math.round(ratio * 100),
      alert: ratio >= 1 ? "exceeded" : ratio >= ALERT_THRESHOLD ? "near_limit" : null,
    };
  });
}
