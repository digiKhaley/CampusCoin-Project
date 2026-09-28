import { prisma } from "../db.js";

// Explainable rule layer (no black-box model). Learned per-user corrections
// always win over these rules.
export const KEYWORD_RULES = [
  { pattern: /cafe|coffee|canteen|restaurant|food|snack|lunch|dinner|pizza|burger|grocer|delivery|takeaway/i, category: "Food" },
  { pattern: /uber|bolt|taxi|bus|train|metro|fuel|petrol|transport|fare|ride/i, category: "Transport" },
  { pattern: /rent|hostel|dorm|electric|utility|utilities|laundry/i, category: "Hostel/Rent" },
  { pattern: /book|tuition|textbook|stationery|course|exam|printing|lab/i, category: "Academics" },
  { pattern: /netflix|spotify|prime|subscription|disney|hulu|youtube|icloud|app store|gym/i, category: "Subscriptions" },
  { pattern: /movie|cinema|game|concert|party|outing|club|ticket/i, category: "Entertainment" },
];

const INCOME_RULES = [
  { pattern: /allowance|pocket|parent|family/i, category: "Allowance" },
  { pattern: /salary|wage|shift|part.?time|job|freelance|gig|tips/i, category: "Part-time Job" },
  { pattern: /scholar|bursary|grant|stipend/i, category: "Scholarship" },
  { pattern: /gift|birthday|present/i, category: "Gift" },
];

export function normalizeKeyword(description) {
  return String(description || "").trim().toLowerCase().split(/\s+/).slice(0, 3).join(" ");
}

function keywordCandidates(description) {
  const words = String(description || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (let n = Math.min(3, words.length); n >= 1; n--) out.push(words.slice(0, n).join(" "));
  return out; // longest first
}

// Load everything once so batch categorization doesn't hit the DB per row.
export async function loadContext(userId) {
  const [categories, corrections] = await Promise.all([
    prisma.category.findMany({ where: { userId } }),
    prisma.categoryCorrection.findMany({ where: { userId } }),
  ]);
  return {
    categories,
    corrections: new Map(corrections.map((c) => [c.keyword, c.categoryId])),
  };
}

export function suggestWith(ctx, description, type) {
  const ofType = ctx.categories.filter((c) => c.type === type);
  const byName = (name) => ofType.find((c) => c.name.toLowerCase() === name.toLowerCase());

  // 1) Learned corrections (longest keyword match first)
  for (const kw of keywordCandidates(description)) {
    const id = ctx.corrections.get(kw);
    const cat = id && ofType.find((c) => c.id === id);
    if (cat) return { categoryId: cat.id, name: cat.name, source: "learned" };
  }

  // 2) Built-in keyword rules
  const rules = type === "expense" ? KEYWORD_RULES : INCOME_RULES;
  for (const rule of rules) {
    if (rule.pattern.test(description || "")) {
      const cat = byName(rule.category);
      if (cat) return { categoryId: cat.id, name: cat.name, source: "rule" };
    }
  }

  // 3) Fallback
  const fb = byName(type === "expense" ? "Miscellaneous" : "Other Income");
  return { categoryId: fb?.id ?? null, name: fb?.name ?? null, source: "fallback" };
}

export async function suggestCategory(userId, description, type) {
  return suggestWith(await loadContext(userId), description, type);
}

export async function learnCorrection(userId, description, categoryId) {
  const keyword = normalizeKeyword(description);
  if (!keyword) return;
  await prisma.categoryCorrection.upsert({
    where: { userId_keyword: { userId, keyword } },
    update: { categoryId },
    create: { userId, keyword, categoryId },
  });
}
