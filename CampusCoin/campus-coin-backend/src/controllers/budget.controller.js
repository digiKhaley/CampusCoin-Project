import { prisma } from "../db.js";
import { monthStart } from "../utils/dates.js";
import { budgetStatus } from "../utils/budgets.js";
import { toPositiveNumber } from "../utils/validate.js";

export async function listBudgets(req, res) {
  const month = monthStart(req.query.month);
  const budgets = await budgetStatus(req.user.id, month);
  res.json({
    month: month.toISOString().slice(0, 7),
    budgets,
    totals: {
      limit: budgets.reduce((s, b) => s + b.limitAmount, 0),
      spent: budgets.reduce((s, b) => s + b.spent, 0),
    },
    alerts: budgets.filter((b) => b.alert),
  });
}

// Create or update the budget for (category, month).
export async function upsertBudget(req, res) {
  const { categoryId } = req.body;
  const limitAmount = toPositiveNumber(req.body.limitAmount);
  if (!categoryId || limitAmount === null) {
    return res.status(400).json({ error: "categoryId and a positive limitAmount are required" });
  }
  const month = monthStart(req.body.month);

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.userId !== req.user.id) return res.status(404).json({ error: "Category not found" });
  if (category.type !== "expense") return res.status(400).json({ error: "Budgets can only be set on expense categories" });

  await prisma.budget.upsert({
    where: { userId_categoryId_month: { userId: req.user.id, categoryId, month } },
    update: { limitAmount },
    create: { userId: req.user.id, categoryId, month, limitAmount },
  });
  const [budget] = (await budgetStatus(req.user.id, month)).filter((b) => b.categoryId === categoryId);
  res.status(201).json({ budget });
}

// Copy last month's budgets into the current (or given) month.
export async function copyBudgets(req, res) {
  const target = monthStart(req.body.month);
  const source = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() - 1, 1));
  const prev = await prisma.budget.findMany({ where: { userId: req.user.id, month: source } });
  if (!prev.length) return res.status(404).json({ error: "No budgets found for the previous month" });

  await prisma.$transaction(
    prev.map((b) =>
      prisma.budget.upsert({
        where: { userId_categoryId_month: { userId: req.user.id, categoryId: b.categoryId, month: target } },
        update: {},
        create: { userId: req.user.id, categoryId: b.categoryId, month: target, limitAmount: b.limitAmount },
      })
    )
  );
  res.status(201).json({ copied: prev.length, budgets: await budgetStatus(req.user.id, target) });
}

export async function deleteBudget(req, res) {
  const existing = await prisma.budget.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: "Budget not found" });
  await prisma.budget.delete({ where: { id: existing.id } });
  res.status(204).send();
}
