import { prisma } from "../db.js";
import { monthTotals, categoryTotals, categoryBreakdown, num, money } from "../utils/aggregates.js";
import { budgetStatus } from "../utils/budgets.js";
import { computeTips } from "../utils/tips.js";
import { upsertInsight } from "../utils/insights.js";
import { computeHealth } from "../utils/health.js";
import { loadContext, suggestWith, learnCorrection, KEYWORD_RULES } from "../utils/categorizer.js";
import { monthStart, addMonths } from "../utils/dates.js";
import { cleanStr, VALID_TYPES } from "../utils/validate.js";

/* ---------- Categorization assistant ---------- */

export async function suggestCategoryHandler(req, res) {
  const description = cleanStr(req.body.description, 200);
  const { type } = req.body;
  if (!description || !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: "description and a valid type are required" });
  }
  const ctx = await loadContext(req.user.id);
  const s = suggestWith(ctx, description, type);
  res.json({ suggestion: s.name, categoryId: s.categoryId, source: s.source });
}

// Batch suggestions, e.g. for a CSV import preview. Body: { items: [{ description, type }] }
export async function suggestBatch(req, res) {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 500) : null;
  if (!items) return res.status(400).json({ error: "items must be an array" });
  const ctx = await loadContext(req.user.id);
  res.json({
    suggestions: items.map((it, i) => {
      const type = VALID_TYPES.includes(it?.type) ? it.type : "expense";
      const s = suggestWith(ctx, cleanStr(it?.description, 200), type);
      return { index: i, suggestion: s.name, categoryId: s.categoryId, source: s.source };
    }),
  });
}

// Student overrode a suggestion -> remember it for next time.
export async function correctCategory(req, res) {
  const description = cleanStr(req.body.description, 200);
  const { categoryId } = req.body;
  if (!description || !categoryId) return res.status(400).json({ error: "description and categoryId are required" });
  const category = await prisma.category.findUnique({ where: { id: String(categoryId) } });
  if (!category || category.userId !== req.user.id) return res.status(404).json({ error: "Category not found" });
  await learnCorrection(req.user.id, description, category.id);
  res.status(204).send();
}

/* ---------- Chat: "Ask Campus Coin anything" ---------- */

const usd = (n) => `$${num(n).toFixed(2)}`;
const stem = (w) => w.trim().toLowerCase().replace(/s$/, "");

function findCategory(q, cats) {
  const direct = cats.find((c) =>
    c.name.toLowerCase().split("/").some((part) => part.trim() && q.includes(stem(part)))
  );
  if (direct) return direct;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(q)) {
      const hit = cats.find((c) => c.type === "expense" && c.name === rule.category);
      if (hit) return hit;
    }
  }
  return null;
}

function compare(cur, prev, prevLabel) {
  if (!(prev > 0)) return "";
  const pct = Math.round((Math.abs(cur - prev) / prev) * 100);
  if (pct === 0) return ` That's about the same as ${prevLabel}.`;
  return ` That's ${pct}% ${cur < prev ? "less" : "more"} than ${prevLabel}${cur < prev ? "!" : "."}`;
}

export async function ask(req, res) {
  const question = cleanStr(req.body.question, 300);
  if (!question) return res.status(400).json({ error: "question is required" });
  const q = question.toLowerCase();

  const offset = /last month|previous month/.test(q) ? -1 : 0;
  const month = addMonths(monthStart(), offset);
  const label = offset === -1 ? "last month" : "this month";
  const prevLabel = offset === -1 ? "the month before" : "last month";
  const userId = req.user.id;

  const cats = await prisma.category.findMany({ where: { userId } });
  const cat = findCategory(q, cats);

  // Budgets
  if (/budget|limit/.test(q)) {
    const budgets = await budgetStatus(userId, month);
    if (!budgets.length) return res.json({ intent: "budget", answer: `You haven't set any budgets for ${label} yet. Add one on the Budgets page.` });
    const list = cat ? budgets.filter((b) => b.categoryId === cat.id) : budgets;
    if (!list.length) return res.json({ intent: "budget", answer: `You don't have a ${cat.name} budget set for ${label}.` });
    const lines = list.map((b) => `${b.category.name}: ${usd(b.spent)} of ${usd(b.limitAmount)} (${b.percentUsed}%)${b.alert === "exceeded" ? " — over!" : b.alert ? " — almost there" : ""}`);
    return res.json({ intent: "budget", answer: `Here's where your budgets stand ${label}: ${lines.join("; ")}.`, data: list });
  }

  // Specific category spend / income
  if (cat) {
    const cur = num((await categoryTotals(userId, month, cat.type)).get(cat.id));
    const prev = num((await categoryTotals(userId, addMonths(month, -1), cat.type)).get(cat.id));
    const verb = cat.type === "income" ? "received" : "spent";
    const on = cat.type === "income" ? "from" : "on";
    return res.json({
      intent: "category",
      answer: `You ${verb} ${usd(cur)} ${on} ${cat.name.toLowerCase()} ${label}.${compare(cur, prev, prevLabel)}`,
      data: { category: cat.name, current: money(cur), previous: money(prev) },
    });
  }

  // Balance / left / safe to spend
  if (/balance|left|remain|afford|safe/.test(q)) {
    const totals = await monthTotals(userId, month);
    const budgets = await budgetStatus(userId, month);
    const h = computeHealth({ income: totals.income, expense: totals.expense, budgets, savingsGoal: num(req.user.monthlySavingsGoal), month });
    const safe = h.daysLeft > 0 ? ` You can safely spend about ${usd(h.safeToSpendToday)} a day for the rest of the month.` : "";
    return res.json({ intent: "balance", answer: `Your balance ${label} is ${usd(totals.balance)} (${usd(totals.income)} in, ${usd(totals.expense)} out).${safe}`, data: totals });
  }

  // Top / biggest category
  if (/biggest|most|top|highest|largest/.test(q)) {
    const top = (await categoryBreakdown(userId, { month, type: "expense" }))[0];
    return res.json({
      intent: "top_category",
      answer: top ? `Your biggest expense ${label} is ${top.category} at ${usd(top.total)} (${top.percent}% of your spending).` : `No expenses logged ${label} yet.`,
      data: top || null,
    });
  }

  // Income
  if (/income|earn|receive|allowance|paid me|got paid/.test(q)) {
    const t = await monthTotals(userId, month);
    const p = await monthTotals(userId, addMonths(month, -1));
    return res.json({ intent: "income", answer: `You brought in ${usd(t.income)} ${label}.${compare(t.income, p.income, prevLabel)}`, data: t });
  }

  // Savings
  if (/sav(e|ing)/.test(q)) {
    const t = await monthTotals(userId, month);
    const goal = num(req.user.monthlySavingsGoal);
    const saved = Math.max(0, t.balance);
    return res.json({
      intent: "savings",
      answer: goal > 0
        ? `You've put aside ${usd(saved)} ${label} toward your ${usd(goal)} goal (${Math.min(100, Math.round((saved / goal) * 100))}%).`
        : `You've kept ${usd(saved)} ${label}. Set a monthly savings goal in your profile to track progress.`,
      data: { saved, goal },
    });
  }

  // Total spend
  if (/spen|spend|total|expens|cost/.test(q)) {
    const t = await monthTotals(userId, month);
    const p = await monthTotals(userId, addMonths(month, -1));
    return res.json({ intent: "total_spend", answer: `You spent ${usd(t.expense)} ${label}.${compare(t.expense, p.expense, prevLabel)}`, data: t });
  }

  res.json({
    intent: "help",
    answer: "I can answer questions about your money — try “How much did I spend on food this month?”, “What's my balance?”, “What's my biggest expense?”, or “How are my budgets doing?”",
  });
}

/* ---------- Monthly insights ---------- */

export async function generateInsight(req, res) {
  const insight = await upsertInsight(req.user.id, monthStart(req.body.month));
  res.status(201).json({ insight });
}

export async function listInsights(req, res) {
  const insights = await prisma.insight.findMany({
    where: { userId: req.user.id },
    orderBy: [{ pinned: "desc" }, { month: "desc" }],
  });
  res.json({ insights });
}

// Bookmark (pin) and annotate an insight (SRS: bookmarking + notes).
export async function updateInsight(req, res) {
  const existing = await prisma.insight.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: "Insight not found" });

  const data = {};
  if (req.body.pinned !== undefined) data.pinned = !!req.body.pinned;
  if (req.body.note !== undefined) data.note = cleanStr(req.body.note, 500) || null;
  res.json({ insight: await prisma.insight.update({ where: { id: existing.id }, data }) });
}

/* ---------- Saving tips ---------- */

export async function listTips(req, res) {
  res.json({ tips: await computeTips(req.user.id, monthStart(req.query.month), { limit: Number(req.query.limit) || 6 }) });
}

export async function updateTipState(req, res) {
  const { categoryId } = req.params;
  const month = monthStart(req.body.month);
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.userId !== req.user.id) return res.status(404).json({ error: "Category not found" });

  const patch = {};
  if (req.body.pinned !== undefined) patch.pinned = !!req.body.pinned;
  if (req.body.dismissed !== undefined) patch.dismissed = !!req.body.dismissed;
  if (req.body.note !== undefined) patch.note = cleanStr(req.body.note, 500) || null;

  const state = await prisma.tipState.upsert({
    where: { userId_categoryId_month: { userId: req.user.id, categoryId, month } },
    update: patch,
    create: { userId: req.user.id, categoryId, month, ...patch },
  });
  res.json({ state });
}
