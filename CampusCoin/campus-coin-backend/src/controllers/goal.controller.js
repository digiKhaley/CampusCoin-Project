import { prisma } from "../db.js";
import { num, money } from "../utils/aggregates.js";
import { cleanStr, toPositiveNumber, toOptionalMoney } from "../utils/validate.js";

const shape = (g) => ({
  ...g,
  percent: num(g.targetAmount) > 0 ? Math.min(100, Math.round((num(g.savedAmount) / num(g.targetAmount)) * 100)) : 0,
  remaining: money(Math.max(0, num(g.targetAmount) - num(g.savedAmount))),
});

async function own(req, res) {
  const g = await prisma.savingsGoal.findUnique({ where: { id: req.params.id } });
  if (!g || g.userId !== req.user.id) { res.status(404).json({ error: "Savings jar not found" }); return null; }
  return g;
}

export async function listGoals(req, res) {
  const goals = await prisma.savingsGoal.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "asc" } });
  res.json({ goals: goals.map(shape) });
}

export async function createGoal(req, res) {
  const name = cleanStr(req.body.name, 60);
  const targetAmount = toPositiveNumber(req.body.targetAmount);
  const saved = toOptionalMoney(req.body.savedAmount);
  if (!name || targetAmount === null || saved === null) {
    return res.status(400).json({ error: "A name and a positive targetAmount are required" });
  }
  const goal = await prisma.savingsGoal.create({
    data: { userId: req.user.id, name, targetAmount, savedAmount: saved ?? 0 },
  });
  res.status(201).json({ goal: shape(goal) });
}

export async function updateGoal(req, res) {
  const g = await own(req, res);
  if (!g) return;
  const data = {};
  if (req.body.name !== undefined) {
    const name = cleanStr(req.body.name, 60);
    if (!name) return res.status(400).json({ error: "Name can't be empty" });
    data.name = name;
  }
  if (req.body.targetAmount !== undefined) {
    const t = toPositiveNumber(req.body.targetAmount);
    if (t === null) return res.status(400).json({ error: "targetAmount must be a positive number" });
    data.targetAmount = t;
  }
  res.json({ goal: shape(await prisma.savingsGoal.update({ where: { id: g.id }, data })) });
}

// Add to (positive) or withdraw from (negative) a jar; never goes below zero.
export async function contribute(req, res) {
  const g = await own(req, res);
  if (!g) return;
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: "amount must be a non-zero number" });
  const next = Math.max(0, money(num(g.savedAmount) + amount));
  res.json({ goal: shape(await prisma.savingsGoal.update({ where: { id: g.id }, data: { savedAmount: next } })) });
}

export async function deleteGoal(req, res) {
  const g = await own(req, res);
  if (!g) return;
  await prisma.savingsGoal.delete({ where: { id: g.id } });
  res.status(204).send();
}
