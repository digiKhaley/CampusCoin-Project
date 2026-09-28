import { prisma } from "../db.js";
import { adminLog } from "../utils/adminLog.js";
import { issueResetEmail } from "./auth.controller.js";
import { startOfTodayUTC } from "../utils/dates.js";
import { cleanStr, VALID_TYPES } from "../utils/validate.js";

/* ---------- Overview stats ---------- */
export async function stats(req, res) {
  const today = startOfTodayUTC();
  const weekAgo = new Date(today.getTime() - 6 * 86400000);
  const students = { isAdmin: false };

  const [totalUsers, activeToday, disabledUsers, totalTransactions, signups, perCategory] = await Promise.all([
    prisma.user.count({ where: students }),
    prisma.user.count({ where: { ...students, lastLoginAt: { gte: today } } }),
    prisma.user.count({ where: { ...students, isDisabled: true } }),
    prisma.transaction.count({ where: { deletedAt: null } }),
    prisma.user.findMany({ where: { ...students, createdAt: { gte: weekAgo } }, select: { createdAt: true } }),
    prisma.transaction.groupBy({ by: ["categoryId"], where: { deletedAt: null }, _count: { _all: true } }),
  ]);

  // Most-used categories, aggregated by name across all students.
  const names = await prisma.category.findMany({
    where: { id: { in: perCategory.map((r) => r.categoryId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(names.map((c) => [c.id, c.name]));
  const byName = new Map();
  perCategory.forEach((r) => {
    const n = nameById.get(r.categoryId);
    if (n) byName.set(n, (byName.get(n) || 0) + r._count._all);
  });
  const topCategories = [...byName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const signupsLast7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekAgo.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: signups.filter((u) => u.createdAt.toISOString().slice(0, 10) === key).length };
  });

  res.json({ totalUsers, activeToday, disabledUsers, totalTransactions, topCategories, signupsLast7Days });
}

/* ---------- Users ---------- */
export async function listUsers(req, res) {
  const q = cleanStr(String(req.query.q || ""), 100);
  const take = Math.min(parseInt(req.query.pageSize, 10) || 25, 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const where = {
    isAdmin: false,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      select: { id: true, name: true, email: true, academicYear: true, isDisabled: true, createdAt: true, lastLoginAt: true },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ users, total, page, pageSize: take });
}

async function studentById(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user || user.isAdmin) { res.status(404).json({ error: "User not found" }); return null; }
  return user;
}

export async function setUserDisabled(req, res) {
  const user = await studentById(req, res);
  if (!user) return;
  if (typeof req.body.isDisabled !== "boolean") return res.status(400).json({ error: "isDisabled (boolean) is required" });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { isDisabled: req.body.isDisabled },
    select: { id: true, name: true, email: true, isDisabled: true },
  });
  await adminLog(req.user, `${updated.isDisabled ? "Disabled" : "Enabled"} ${updated.email}`);
  res.json({ user: updated });
}

export async function resetUserPassword(req, res) {
  const user = await studentById(req, res);
  if (!user) return;
  await issueResetEmail(user);
  await adminLog(req.user, `Sent password reset to ${user.email}`);
  res.json({ message: `Reset link sent to ${user.email}` });
}

/* ---------- Default categories (copied to new students at registration) ---------- */
export async function listDefaultCategories(req, res) {
  const categories = await prisma.defaultCategory.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  res.json({
    categories,
    income: categories.filter((c) => c.type === "income"),
    expense: categories.filter((c) => c.type === "expense"),
  });
}

export async function createDefaultCategory(req, res) {
  const name = cleanStr(req.body.name, 60);
  const { type } = req.body;
  if (!name || !VALID_TYPES.includes(type)) return res.status(400).json({ error: "A name and a valid type are required" });

  const dupe = await prisma.defaultCategory.findFirst({ where: { type, name: { equals: name, mode: "insensitive" } } });
  if (dupe) return res.status(409).json({ error: "That default category already exists" });

  const category = await prisma.defaultCategory.create({ data: { name, type } });
  await adminLog(req.user, `Added default ${type} category: ${name}`);
  res.status(201).json({ category });
}

export async function updateDefaultCategory(req, res) {
  const name = cleanStr(req.body.name, 60);
  if (!name) return res.status(400).json({ error: "name is required" });
  const existing = await prisma.defaultCategory.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Default category not found" });

  const category = await prisma.defaultCategory.update({ where: { id: existing.id }, data: { name } });
  await adminLog(req.user, `Renamed default category ${existing.name} → ${name}`);
  res.json({ category });
}

export async function deleteDefaultCategory(req, res) {
  const existing = await prisma.defaultCategory.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Default category not found" });
  await prisma.defaultCategory.delete({ where: { id: existing.id } });
  await adminLog(req.user, `Removed default ${existing.type} category: ${existing.name}`);
  res.status(204).send();
}

/* ---------- Announcements & tip templates ---------- */
const normType = (t) => String(t || "announcement").trim().toLowerCase().replace(/\s+/g, "_");

export async function listAnnouncements(req, res) {
  res.json({ announcements: await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } }) });
}

export async function createAnnouncement(req, res) {
  const type = normType(req.body.type);
  const title = cleanStr(req.body.title, 120);
  const body = cleanStr(req.body.body, 1000);
  if (!["announcement", "tip_template"].includes(type) || !title || !body) {
    return res.status(400).json({ error: "type ('announcement' or 'tip_template'), title, and body are required" });
  }
  const announcement = await prisma.announcement.create({ data: { type, title, body } });
  await adminLog(req.user, `Published ${type.replace("_", " ")}: ${title}`);
  res.status(201).json({ announcement });
}

export async function deleteAnnouncement(req, res) {
  const existing = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Announcement not found" });
  await prisma.announcement.delete({ where: { id: existing.id } });
  await adminLog(req.user, `Deleted ${existing.type.replace("_", " ")}: ${existing.title}`);
  res.status(204).send();
}

/* ---------- Activity log ---------- */
export async function activityLog(req, res) {
  const take = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  res.json({ log: await prisma.adminLog.findMany({ orderBy: { createdAt: "desc" }, take }) });
}
