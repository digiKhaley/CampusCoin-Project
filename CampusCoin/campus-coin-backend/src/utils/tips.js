import { prisma } from "../db.js";
import { categoryTotals, num, money } from "./aggregates.js";
import { addMonths } from "./dates.js";

// Ranked saving tips: current spend vs. trailing 3-month average and vs. the
// category's budget limit, ranked by potential savings (SRS "Tips Engine").
export async function computeTips(userId, month, { limit = 6 } = {}) {
  const current = await categoryTotals(userId, month, "expense");
  const history = await Promise.all(
    [1, 2, 3].map((n) => categoryTotals(userId, addMonths(month, -n), "expense"))
  );

  const [categories, budgets, states] = await Promise.all([
    prisma.category.findMany({ where: { userId, type: "expense" } }),
    prisma.budget.findMany({ where: { userId, month } }),
    prisma.tipState.findMany({ where: { userId, month } }),
  ]);
  const limitBy = new Map(budgets.map((b) => [b.categoryId, num(b.limitAmount)]));
  const stateBy = new Map(states.map((s) => [s.categoryId, s]));

  const tips = [];
  for (const cat of categories) {
    const state = stateBy.get(cat.id);
    if (state?.dismissed) continue;

    const cur = current.get(cat.id) || 0;
    const avg = history.reduce((s, h) => s + (h.get(cat.id) || 0), 0) / history.length;
    const lim = limitBy.get(cat.id);

    const overAvg = avg > 0 ? cur - avg : 0;
    const overBudget = lim ? cur - lim : 0;
    const potentialSavings = Math.max(overAvg, overBudget, 0);

    if (potentialSavings <= 0 && !state?.pinned) continue;

    tips.push({
      categoryId: cat.id,
      category: cat.name,
      currentAmount: money(cur),
      average: money(avg),
      limit: lim ?? null,
      potentialSavings: money(potentialSavings),
      pinned: !!state?.pinned,
      note: state?.note ?? null,
      message:
        overBudget > 0
          ? `You're $${overBudget.toFixed(2)} over your ${cat.name} budget this month.`
          : overAvg > 0
          ? `${cat.name} spending is $${overAvg.toFixed(2)} above your recent average — try trimming it.`
          : `Pinned: ${cat.name}`,
    });
  }

  tips.sort((a, b) => (b.pinned - a.pinned) || b.potentialSavings - a.potentialSavings);
  return tips.slice(0, limit);
}
