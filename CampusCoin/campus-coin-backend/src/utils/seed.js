// Usage:
//   npm run seed         — admin account + default category catalog only
//   npm run seed:demo    — the above, plus one demo student with real data
import "dotenv/config";
import { prisma } from "../db.js";
import { hashPassword } from "./password.js";
import { monthStart, addMonths } from "./dates.js";

const DEFAULTS = [
  ["Allowance", "income"], ["Part-time Job", "income"], ["Scholarship", "income"],
  ["Gift", "income"], ["Other Income", "income"],
  ["Food", "expense"], ["Transport", "expense"], ["Hostel/Rent", "expense"],
  ["Academics", "expense"], ["Subscriptions", "expense"], ["Entertainment", "expense"],
  ["Miscellaneous", "expense"],
];

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Admin";
  if (!email || !password) { console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first."); process.exit(1); }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) { console.log(`Admin already exists: ${email}`); return; }
  await prisma.user.create({ data: { name, email, passwordHash: await hashPassword(password), isAdmin: true } });
  console.log(`Admin created: ${email}`);
}

async function seedDefaultCategories() {
  for (const [name, type] of DEFAULTS) {
    await prisma.defaultCategory.upsert({
      where: { name_type: { name, type } },
      update: {},
      create: { name, type },
    });
  }
  console.log(`Default categories seeded (${DEFAULTS.length}).`);
}

async function seedDemoStudent() {
  const email = "dave@campuscoin.app";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: "Dave", email, passwordHash: await hashPassword("Password123"),
        academicYear: "Year 2", monthlyAllowance: 400, monthlySavingsGoal: 100,
        categories: { create: DEFAULTS.map(([name, type]) => ({ name, type, isDefault: true })) },
      },
    });
    console.log(`Demo student created: ${email} / Password123`);
  } else {
    console.log(`Demo student already exists: ${email}`);
  }

  const cats = await prisma.category.findMany({ where: { userId: user.id } });
  const byName = (n, t) => cats.find((c) => c.name === n && c.type === t);

  const existingTxns = await prisma.transaction.count({ where: { userId: user.id } });
  if (existingTxns === 0) {
    const now = monthStart();
    const rows = [];
    for (let m = 0; m < 4; m++) {
      const month = addMonths(now, -m);
      rows.push({ userId: user.id, categoryId: byName("Allowance", "income").id, type: "income", amount: 400, description: "Monthly allowance", date: new Date(month) });
      const food = m === 0 ? 142.3 : 90 + m * 8;
      rows.push({ userId: user.id, categoryId: byName("Food", "expense").id, type: "expense", amount: food, description: "Campus Cafe", date: addMonths(month, 0) });
      rows.push({ userId: user.id, categoryId: byName("Transport", "expense").id, type: "expense", amount: 22, description: "Bus fare", date: addMonths(month, 0) });
      rows.push({ userId: user.id, categoryId: byName("Subscriptions", "expense").id, type: "expense", amount: 15, description: "Netflix", date: addMonths(month, 0) });
      if (m === 0) rows.push({ userId: user.id, categoryId: byName("Academics", "expense").id, type: "expense", amount: 42, description: "Textbook", date: addMonths(month, 0) });
    }
    await prisma.transaction.createMany({ data: rows });
    await prisma.budget.createMany({
      data: [
        { userId: user.id, categoryId: byName("Food", "expense").id, month: now, limitAmount: 100 },
        { userId: user.id, categoryId: byName("Transport", "expense").id, month: now, limitAmount: 50 },
        { userId: user.id, categoryId: byName("Subscriptions", "expense").id, month: now, limitAmount: 30 },
      ],
    });
    await prisma.savingsGoal.createMany({
      data: [
        { userId: user.id, name: "Laptop fund", targetAmount: 900, savedAmount: 340 },
        { userId: user.id, name: "Spring trip", targetAmount: 400, savedAmount: 120 },
      ],
    });
    await prisma.splitExpense.createMany({
      data: [
        { userId: user.id, title: "Hostel electricity", totalAmount: 42, myShare: 10.5, splitCount: 4, paidByMe: false, participants: ["Sam", "Priya", "Tunde"] },
        { userId: user.id, title: "Weekend groceries", totalAmount: 28, myShare: 14, splitCount: 2, paidByMe: true, participants: ["Sam"] },
      ],
    });
    console.log("Demo transactions, budgets, goals, and splits seeded.");
  }
}

async function main() {
  await seedAdmin();
  await seedDefaultCategories();
  if (process.argv.includes("--demo")) await seedDemoStudent();
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
