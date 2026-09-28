import { prisma } from "../db.js";
import { monthTotals, num } from "../utils/aggregates.js";
import { monthStart, addMonths, addMonthsKeepDay, parseDate, startOfTodayUTC } from "../utils/dates.js";
import { processRecurring } from "../utils/recurring.js";
import { loadContext, suggestWith, learnCorrection } from "../utils/categorizer.js";
import { parseCsv } from "../utils/csv.js";
import { toPositiveNumber, cleanStr, VALID_TYPES } from "../utils/validate.js";

const snapshotOf = (t) => JSON.parse(JSON.stringify(t));

async function record(action, txn) {
  await prisma.transactionHistory.create({
    data: { transactionId: txn.id, userId: txn.userId, action, snapshot: snapshotOf(txn) },
  });
}

async function ownCategoryOfType(userId, categoryId, type) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.userId !== userId) return { error: "Category not found" };
  if (category.type !== type) return { error: `That category is for ${category.type}, not ${type}` };
  return { category };
}

async function ownTransaction(req, res, { allowDeleted = false } = {}) {
  const t = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!t || t.userId !== req.user.id || (!allowDeleted && t.deletedAt)) {
    res.status(404).json({ error: "Transaction not found" });
    return null;
  }
  return t;
}

// SRS optional "system intelligence": flag duplicates and unusually large amounts.
async function anomalyFlags(userId, { categoryId, amount, type, description, date }) {
  const flags = [];
  const dup = await prisma.transaction.findFirst({
    where: { userId, deletedAt: null, categoryId, type, amount, date, description: description || null },
  });
  if (dup) flags.push({ code: "possible_duplicate", message: "A matching transaction already exists for that day." });

  if (type === "expense") {
    const agg = await prisma.transaction.aggregate({
      where: { userId, deletedAt: null, categoryId, type: "expense", date: { gte: addMonths(monthStart(), -3) } },
      _avg: { amount: true },
      _count: { _all: true },
    });
    const avg = num(agg._avg.amount);
    if (agg._count._all >= 5 && avg > 0 && amount > avg * 3) {
      flags.push({
        code: "unusually_large",
        message: `That's more than 3× your usual amount for this category (avg $${avg.toFixed(2)}).`,
      });
    }
  }
  return flags;
}

export async function listTransactions(req, res) {
  await processRecurring(req.user.id);
  const { type, categoryId, from, to, q, deleted, sort = "date_desc" } = req.query;

  const where = { userId: req.user.id, deletedAt: deleted === "true" ? { not: null } : null };
  if (type) {
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: "type must be 'income' or 'expense'" });
    where.type = type;
  }
  if (categoryId) where.categoryId = String(categoryId);
  if (from || to) {
    where.date = {};
    if (from) { const d = parseDate(from); if (!d) return res.status(400).json({ error: "Invalid 'from' date" }); where.date.gte = d; }
    if (to) { const d = parseDate(to); if (!d) return res.status(400).json({ error: "Invalid 'to' date" }); where.date.lte = d; }
  }
  if (q) where.description = { contains: String(q).slice(0, 100), mode: "insensitive" };

  const orderBy = {
    date_desc: [{ date: "desc" }, { createdAt: "desc" }],
    date_asc: [{ date: "asc" }, { createdAt: "asc" }],
    amount_desc: [{ amount: "desc" }],
    amount_asc: [{ amount: "asc" }],
  }[sort] || [{ date: "desc" }];

  const take = Math.min(parseInt(req.query.pageSize, 10) || 25, 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({ where, include: { category: true }, orderBy, skip: (page - 1) * take, take }),
    prisma.transaction.count({ where }),
  ]);
  res.json({ transactions, total, page, pageSize: take, totalPages: Math.max(1, Math.ceil(total / take)) });
}

export async function createTransaction(req, res) {
  const { categoryId, type, aiSuggestedCategory } = req.body;
  const amount = toPositiveNumber(req.body.amount);
  const date = req.body.date ? parseDate(req.body.date) : startOfTodayUTC();
  const description = cleanStr(req.body.description, 200) || null;

  if (!categoryId || !VALID_TYPES.includes(type) || amount === null || !date) {
    return res.status(400).json({ error: "categoryId, type, a positive amount, and a valid date are required" });
  }
  const check = await ownCategoryOfType(req.user.id, categoryId, type);
  if (check.error) return res.status(400).json({ error: check.error });

  const isRecurring = req.body.isRecurring === true || req.body.isRecurring === "true";
  const flags = await anomalyFlags(req.user.id, { categoryId, amount, type, description, date });

  // If the student overrode the assistant's suggestion, remember the correction.
  let aiId = null;
  if (aiSuggestedCategory) {
    const sug = await prisma.category.findUnique({ where: { id: String(aiSuggestedCategory) } });
    if (sug && sug.userId === req.user.id) {
      aiId = sug.id;
      if (sug.id !== categoryId && description) await learnCorrection(req.user.id, description, categoryId);
    }
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId: req.user.id, categoryId, type, amount, description, date,
      aiSuggestedCategory: aiId,
      isRecurring,
      nextOccurrence: isRecurring ? addMonthsKeepDay(date, 1) : null,
    },
    include: { category: true },
  });
  await record("created", transaction);

  res.status(201).json({ transaction, flags });
}

export async function updateTransaction(req, res) {
  const existing = await ownTransaction(req, res);
  if (!existing) return;

  const data = {};
  const nextType = req.body.type ?? existing.type;
  if (req.body.type !== undefined && !VALID_TYPES.includes(req.body.type)) {
    return res.status(400).json({ error: "type must be 'income' or 'expense'" });
  }
  if (req.body.type !== undefined) data.type = req.body.type;

  const catId = req.body.categoryId ?? existing.categoryId;
  if (req.body.categoryId !== undefined || req.body.type !== undefined) {
    const check = await ownCategoryOfType(req.user.id, catId, nextType);
    if (check.error) return res.status(400).json({ error: check.error });
    data.categoryId = catId;
  }
  if (req.body.amount !== undefined) {
    const a = toPositiveNumber(req.body.amount);
    if (a === null) return res.status(400).json({ error: "amount must be a positive number" });
    data.amount = a;
  }
  if (req.body.description !== undefined) data.description = cleanStr(req.body.description, 200) || null;
  if (req.body.date !== undefined) {
    const d = parseDate(req.body.date);
    if (!d) return res.status(400).json({ error: "Invalid date" });
    data.date = d;
  }
  if (req.body.isRecurring !== undefined) {
    const on = req.body.isRecurring === true || req.body.isRecurring === "true";
    data.isRecurring = on;
    data.nextOccurrence = on ? addMonthsKeepDay(data.date ?? existing.date, 1) : null;
  }

  const transaction = await prisma.transaction.update({ where: { id: existing.id }, data, include: { category: true } });
  await prisma.transactionHistory.create({
    data: { transactionId: existing.id, userId: req.user.id, action: "updated", snapshot: { before: snapshotOf(existing), after: snapshotOf(transaction) } },
  });
  res.json({ transaction });
}

// Soft delete: the row and its history are retained (SRS 1.6).
export async function deleteTransaction(req, res) {
  const existing = await ownTransaction(req, res);
  if (!existing) return;
  const updated = await prisma.transaction.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await record("deleted", updated);
  res.status(204).send();
}

export async function restoreTransaction(req, res) {
  const existing = await ownTransaction(req, res, { allowDeleted: true });
  if (!existing) return;
  if (!existing.deletedAt) return res.status(400).json({ error: "Transaction isn't deleted" });
  const transaction = await prisma.transaction.update({ where: { id: existing.id }, data: { deletedAt: null }, include: { category: true } });
  await record("restored", transaction);
  res.json({ transaction });
}

export async function transactionHistory(req, res) {
  const existing = await ownTransaction(req, res, { allowDeleted: true });
  if (!existing) return;
  const history = await prisma.transactionHistory.findMany({
    where: { transactionId: existing.id, userId: req.user.id },
    orderBy: { createdAt: "asc" },
  });
  res.json({ history });
}

export async function listRecurring(req, res) {
  const recurring = await prisma.transaction.findMany({
    where: { userId: req.user.id, isRecurring: true, deletedAt: null },
    include: { category: true },
    orderBy: { nextOccurrence: "asc" },
  });
  res.json({ recurring });
}

export async function summary(req, res) {
  await processRecurring(req.user.id);
  const month = monthStart(req.query.month);
  res.json({ month: month.toISOString().slice(0, 7), ...(await monthTotals(req.user.id, month)) });
}

// CSV bulk import (SRS optional). Columns: date, amount, [category], [type], [description].
// Missing/unknown categories are filled in by the AI categorizer (batch suggestions).
export async function importCsv(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (expected form field 'file')" });

  const rows = parseCsv(req.file.buffer.toString("utf-8").replace(/^\uFEFF/, ""));
  if (rows.length < 2) return res.status(400).json({ error: "CSV needs a header row plus at least one data row" });
  if (rows.length > 2001) return res.status(400).json({ error: "CSV is limited to 2,000 rows per import" });

  const alias = { note: "description", notes: "description", memo: "description", details: "description", desc: "description" };
  const header = rows[0].map((h) => { const k = h.trim().toLowerCase(); return alias[k] || k; });
  if (!header.includes("date") || !header.includes("amount")) {
    return res.status(400).json({ error: "CSV must include at least 'date' and 'amount' columns" });
  }

  const ctx = await loadContext(req.user.id);
  const byKey = new Map(ctx.categories.map((c) => [`${c.name.toLowerCase()}:${c.type}`, c]));
  const toCreate = [];
  const skipped = [];
  let aiCategorized = 0;

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const row = Object.fromEntries(header.map((h, idx) => [h, (cells[idx] ?? "").trim()]));

    const date = parseDate(row.date);
    const rawAmount = Number(String(row.amount).replace(/[$,\s]/g, ""));
    if (!date) return skipped.push({ row: line, reason: "Invalid date" });
    if (!Number.isFinite(rawAmount) || rawAmount === 0) return skipped.push({ row: line, reason: "Invalid amount" });

    let type = row.type?.toLowerCase();
    if (!VALID_TYPES.includes(type)) type = rawAmount < 0 ? "expense" : "income";
    const amount = Math.round(Math.abs(rawAmount) * 100) / 100;
    const description = cleanStr(row.description, 200) || null;

    let cat = row.category ? byKey.get(`${row.category.toLowerCase()}:${type}`) : null;
    let aiId = null;
    if (!cat) {
      const s = suggestWith(ctx, description || row.category || "", type);
      cat = s.categoryId ? ctx.categories.find((c) => c.id === s.categoryId) : null;
      if (!cat) return skipped.push({ row: line, reason: "No matching category" });
      aiId = cat.id;
      aiCategorized++;
    }
    toCreate.push({ userId: req.user.id, categoryId: cat.id, type, amount, description, date, aiSuggestedCategory: aiId });
  });

  if (toCreate.length) await prisma.transaction.createMany({ data: toCreate });
  res.json({ imported: toCreate.length, aiCategorized, skipped });
}
