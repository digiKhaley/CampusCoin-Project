import { prisma } from "../db.js";
import { cleanStr, VALID_TYPES } from "../utils/validate.js";

export async function listCategories(req, res) {
  const { type } = req.query;
  const where = { userId: req.user.id };
  if (type) {
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: "type must be 'income' or 'expense'" });
    where.type = type;
  }
  const categories = await prisma.category.findMany({
    where,
    orderBy: [{ type: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
  res.json({
    categories,
    income: categories.filter((c) => c.type === "income"),
    expense: categories.filter((c) => c.type === "expense"),
  });
}

export async function createCategory(req, res) {
  const name = cleanStr(req.body.name, 60);
  const { type } = req.body;
  if (!name || !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: "A name and a valid type ('income' or 'expense') are required" });
  }

  const dupe = await prisma.category.findFirst({
    where: { userId: req.user.id, type, name: { equals: name, mode: "insensitive" } },
  });
  if (dupe) return res.status(409).json({ error: "You already have a category with this name and type" });

  const category = await prisma.category.create({
    data: { userId: req.user.id, name, type, isDefault: false },
  });
  res.status(201).json({ category });
}

async function ownCategory(req, res) {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category || category.userId !== req.user.id) {
    res.status(404).json({ error: "Category not found" });
    return null;
  }
  return category;
}

export async function updateCategory(req, res) {
  const category = await ownCategory(req, res);
  if (!category) return;
  if (category.isDefault) {
    return res.status(403).json({ error: "Default categories can't be edited. Create your own category instead." });
  }
  const name = cleanStr(req.body.name, 60);
  if (!name) return res.status(400).json({ error: "name is required" });

  const dupe = await prisma.category.findFirst({
    where: { userId: req.user.id, type: category.type, id: { not: category.id }, name: { equals: name, mode: "insensitive" } },
  });
  if (dupe) return res.status(409).json({ error: "You already have a category with this name and type" });

  const updated = await prisma.category.update({ where: { id: category.id }, data: { name } });
  res.json({ category: updated });
}

export async function deleteCategory(req, res) {
  const category = await ownCategory(req, res);
  if (!category) return;
  if (category.isDefault) return res.status(403).json({ error: "Default categories can't be deleted" });

  const inUse = await prisma.transaction.count({ where: { categoryId: category.id, deletedAt: null } });
  if (inUse) {
    return res.status(409).json({
      error: `This category has ${inUse} transaction${inUse === 1 ? "" : "s"} attached — reassign or delete them first`,
    });
  }

  // Only soft-deleted transactions (kept for history) can remain; clear them and
  // anything else pointing at this category so the FK constraint doesn't block us.
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { categoryId: category.id } }),
    prisma.budget.deleteMany({ where: { categoryId: category.id } }),
    prisma.categoryCorrection.deleteMany({ where: { categoryId: category.id } }),
    prisma.tipState.deleteMany({ where: { categoryId: category.id } }),
    prisma.category.delete({ where: { id: category.id } }),
  ]);
  res.status(204).send();
}
