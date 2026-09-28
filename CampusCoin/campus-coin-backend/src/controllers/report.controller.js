import { prisma } from "../db.js";
import { monthTotals, categoryBreakdown, categoryTotals, num, money } from "../utils/aggregates.js";
import { monthStart, addMonths, monthKey, monthLabel, daysInMonth, parseDate } from "../utils/dates.js";
import { buildMonthlyPdf } from "../utils/pdf.js";
import { sendMail } from "../utils/mailer.js";
import { isEmail, normEmail, VALID_TYPES } from "../utils/validate.js";

// Category-wise report with the SRS filters: month OR date range, category, type (income source).
export async function getCategoryBreakdown(req, res) {
  const { type, categoryId, from, to } = req.query;
  if (type && !VALID_TYPES.includes(type)) return res.status(400).json({ error: "type must be 'income' or 'expense'" });

  const opts = { type: type || undefined, categoryId: categoryId ? String(categoryId) : undefined };
  if (from || to) {
    opts.from = from ? parseDate(from) : undefined;
    opts.to = to ? parseDate(to) : undefined;
    if ((from && !opts.from) || (to && !opts.to)) return res.status(400).json({ error: "Invalid date range" });
  } else {
    opts.month = monthStart(req.query.month);
  }

  const breakdown = await categoryBreakdown(req.user.id, opts);
  res.json({
    month: opts.month ? monthKey(opts.month) : null,
    from: from || null,
    to: to || null,
    breakdown,
    totals: {
      income: money(breakdown.filter((b) => b.type === "income").reduce((s, b) => s + b.total, 0)),
      expense: money(breakdown.filter((b) => b.type === "expense").reduce((s, b) => s + b.total, 0)),
    },
  });
}

// Income vs. expense for the last N months (default 6, per SRS).
export async function getIncomeVsExpense(req, res) {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
  const now = monthStart();
  const list = Array.from({ length: months }, (_, i) => addMonths(now, i - (months - 1)));
  const totals = await Promise.all(list.map((m) => monthTotals(req.user.id, m)));
  res.json({
    series: list.map((m, i) => ({ month: monthKey(m), label: monthLabel(m), ...totals[i] })),
  });
}

// Daily or weekly spending for a month (or arbitrary range), optionally filtered by category.
export async function getPeriodSummary(req, res) {
  const granularity = req.query.granularity === "weekly" ? "weekly" : "daily";
  const month = monthStart(req.query.month);
  const where = { userId: req.user.id, deletedAt: null, type: req.query.type === "income" ? "income" : "expense" };
  if (req.query.categoryId) where.categoryId = String(req.query.categoryId);

  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = parseDate(req.query.from);
    if (req.query.to) where.date.lte = parseDate(req.query.to);
  } else {
    where.date = { gte: month, lt: addMonths(month, 1) };
  }

  const txns = await prisma.transaction.findMany({ where, select: { amount: true, date: true } });
  const buckets = new Map();

  // Pre-fill so charts get a continuous axis for month views.
  if (!req.query.from && !req.query.to) {
    const dim = daysInMonth(month);
    if (granularity === "weekly") for (let w = 1; w <= Math.ceil(dim / 7); w++) buckets.set(`Week ${w}`, 0);
    else for (let d = 1; d <= dim; d++) buckets.set(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), d)).toISOString().slice(0, 10), 0);
  }

  for (const t of txns) {
    const key = granularity === "weekly" ? `Week ${Math.ceil(t.date.getUTCDate() / 7)}` : t.date.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + num(t.amount));
  }

  const summary = [...buckets.entries()]
    .map(([period, total]) => ({ period, total: money(total) }))
    .sort((a, b) => (a.period > b.period ? 1 : -1));
  res.json({ granularity, summary, total: money(summary.reduce((s, r) => s + r.total, 0)) });
}

// Next-month forecast from the trailing 3 months (SRS optional "System Intelligence").
export async function getForecast(req, res) {
  const now = monthStart();
  const past = [1, 2, 3].map((n) => addMonths(now, -n));
  const totals = await Promise.all(past.map((m) => monthTotals(req.user.id, m)));
  const withData = totals.filter((t) => t.income > 0 || t.expense > 0);
  const n = withData.length;

  const avg = (k) => (n ? money(withData.reduce((s, t) => s + t[k], 0) / n) : 0);
  const income = avg("income");
  const expense = avg("expense");

  const perCat = await Promise.all(past.map((m) => categoryTotals(req.user.id, m, "expense")));
  const sums = new Map();
  perCat.forEach((map) => map.forEach((v, id) => sums.set(id, (sums.get(id) || 0) + v)));
  const cats = await prisma.category.findMany({ where: { id: { in: [...sums.keys()] } } });
  const categories = cats
    .map((c) => ({ categoryId: c.id, category: c.name, projected: money((sums.get(c.id) || 0) / Math.max(n, 1)) }))
    .sort((a, b) => b.projected - a.projected)
    .slice(0, 6);

  res.json({
    month: monthKey(addMonths(now, 1)),
    basedOnMonths: n,
    income,
    expense,
    balance: money(income - expense),
    categories,
    note: n === 0 ? "Not enough history yet — log a few months of transactions to see a forecast." : undefined,
  });
}

export async function exportPdf(req, res) {
  const month = monthStart(req.query.month);
  const pdf = await buildMonthlyPdf(req.user, month);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="campus-coin-${monthKey(month)}.pdf"`);
  res.send(pdf);
}

// Email the monthly report (PDF attached) to yourself or someone else, e.g. a parent.
export async function shareByEmail(req, res) {
  const to = normEmail(req.body.email || req.user.email);
  if (!isEmail(to)) return res.status(400).json({ error: "A valid email is required" });
  const month = monthStart(req.body.month);
  const pdf = await buildMonthlyPdf(req.user, month);

  await sendMail({
    to,
    subject: `${req.user.name}'s Campus Coin report — ${monthLabel(month)}`,
    text: `${req.user.name} shared their Campus Coin monthly report for ${monthLabel(month)}. It's attached as a PDF.`,
    attachments: [{ filename: `campus-coin-${monthKey(month)}.pdf`, content: pdf, contentType: "application/pdf" }],
  });
  res.json({ message: `Report sent to ${to}` });
}
