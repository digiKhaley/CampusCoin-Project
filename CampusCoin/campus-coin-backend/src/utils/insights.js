import { prisma } from "../db.js";
import { categoryTotals, money } from "./aggregates.js";
import { addMonths } from "./dates.js";

// Monthly narrative insight: flags the expense category with the largest growth
// vs. its trailing 3-month average and pairs it with a simple, actionable tip.
export async function buildInsight(userId, month) {
  const current = await categoryTotals(userId, month, "expense");
  const history = await Promise.all(
    [1, 2, 3].map((n) => categoryTotals(userId, addMonths(month, -n), "expense"))
  );
  const categories = await prisma.category.findMany({ where: { userId, type: "expense" } });

  let biggest = null;
  for (const cat of categories) {
    const cur = current.get(cat.id) || 0;
    const avg = history.reduce((s, h) => s + (h.get(cat.id) || 0), 0) / history.length;
    if (avg <= 0 || cur <= 0) continue;
    const growth = (cur - avg) / avg;
    if (growth > 0.15 && (!biggest || growth > biggest.growth)) biggest = { cat, cur, avg, growth };
  }

  if (biggest) {
    const pct = Math.round(biggest.growth * 100);
    const weekly = money(biggest.avg / 4.3);
    return {
      summaryText: `${biggest.cat.name} spending rose ${pct}% this month ($${biggest.cur.toFixed(2)} vs. a $${biggest.avg.toFixed(2)} average).`,
      tipText: `Try a weekly cap of about $${weekly.toFixed(2)} on ${biggest.cat.name.toLowerCase()}, or set a budget limit for it.`,
    };
  }

  const total = Array.from(current.values()).reduce((s, v) => s + v, 0);
  return total > 0
    ? {
        summaryText: "Spending looks steady this month — no category jumped out compared to your recent average.",
        tipText: "Keep logging transactions as they happen so next month's insight has more to compare against.",
      }
    : {
        summaryText: "No expenses logged yet this month.",
        tipText: "Add a few transactions and Campus Coin will start spotting patterns for you.",
      };
}

export async function upsertInsight(userId, month) {
  const { summaryText, tipText } = await buildInsight(userId, month);
  return prisma.insight.upsert({
    where: { userId_month: { userId, month } },
    update: { summaryText, tipText, generatedAt: new Date() },
    create: { userId, month, summaryText, tipText },
  });
}
