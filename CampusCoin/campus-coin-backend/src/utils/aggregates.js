import { prisma } from "../db.js";
import { addMonths } from "./dates.js";

export const num = (v) => Number(v ?? 0);
export const money = (v) => Math.round(num(v) * 100) / 100;

const live = { deletedAt: null };

export async function monthTotals(userId, month) {
  const rows = await prisma.transaction.groupBy({
    by: ["type"],
    where: { userId, ...live, date: { gte: month, lt: addMonths(month, 1) } },
    _sum: { amount: true },
  });
  const income = money(rows.find((r) => r.type === "income")?._sum.amount);
  const expense = money(rows.find((r) => r.type === "expense")?._sum.amount);
  return { income, expense, balance: money(income - expense) };
}

// Map(categoryId -> total) for one month.
export async function categoryTotals(userId, month, type = "expense") {
  const rows = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: { userId, type, ...live, date: { gte: month, lt: addMonths(month, 1) } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.categoryId, num(r._sum.amount)]));
}

// Category breakdown for a month or an arbitrary from/to range.
// Supports the SRS report filters: date range, category, income source (type=income).
export async function categoryBreakdown(userId, { month, from, to, type, categoryId } = {}) {
  const where = { userId, ...live };
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = from;
    if (to) where.date.lte = to;
  } else if (month) {
    where.date = { gte: month, lt: addMonths(month, 1) };
  }
  if (type) where.type = type;
  if (categoryId) where.categoryId = categoryId;

  const rows = await prisma.transaction.groupBy({
    by: ["categoryId", "type"],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });

  const cats = await prisma.category.findMany({
    where: { id: { in: rows.map((r) => r.categoryId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(cats.map((c) => [c.id, c.name]));

  const totalsByType = { income: 0, expense: 0 };
  rows.forEach((r) => { totalsByType[r.type] += num(r._sum.amount); });

  return rows
    .map((r) => ({
      categoryId: r.categoryId,
      category: nameById.get(r.categoryId) || "Unknown",
      type: r.type,
      total: money(r._sum.amount),
      count: r._count._all,
      percent: totalsByType[r.type] > 0 ? Math.round((num(r._sum.amount) / totalsByType[r.type]) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
