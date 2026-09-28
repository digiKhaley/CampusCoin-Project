import PDFDocument from "pdfkit";
import { prisma } from "../db.js";
import { categoryBreakdown, monthTotals, num } from "./aggregates.js";
import { budgetStatus } from "./budgets.js";
import { monthLabel } from "./dates.js";

// Monthly report as a PDF buffer (download + email attachment).
export async function buildMonthlyPdf(user, month) {
  const [totals, breakdown, budgets, goals, insight] = await Promise.all([
    monthTotals(user.id, month),
    categoryBreakdown(user.id, { month }),
    budgetStatus(user.id, month),
    prisma.savingsGoal.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.insight.findUnique({ where: { userId_month: { userId: user.id, month } } }),
  ]);

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const green = "#0e9a63";
  const grey = "#666666";
  const usd = (n) => `$${num(n).toFixed(2)}`;

  const row = (left, right) => {
    const y = doc.y;
    doc.fontSize(11).fillColor("#111").text(left, 50, y, { width: 330 });
    doc.text(right, 380, y, { width: 165, align: "right" });
    doc.moveDown(0.3);
  };
  const heading = (t) => {
    doc.moveDown(0.8).fontSize(13).fillColor(green).text(t);
    doc.moveDown(0.3);
  };

  doc.fontSize(22).fillColor("#111").text("Campus Coin");
  doc.fontSize(12).fillColor(grey).text(`Monthly report — ${monthLabel(month)}`);
  doc.text(`Prepared for ${user.name}`);

  heading("Summary");
  row("Income", usd(totals.income));
  row("Expenses", usd(totals.expense));
  row("Balance", usd(totals.balance));

  const expenses = breakdown.filter((b) => b.type === "expense");
  const incomes = breakdown.filter((b) => b.type === "income");

  heading("Spending by category");
  if (!expenses.length) doc.fontSize(11).fillColor(grey).text("No expenses this month.");
  expenses.forEach((b) => row(`${b.category} (${b.percent}%)`, usd(b.total)));

  if (incomes.length) {
    heading("Income by source");
    incomes.forEach((b) => row(b.category, usd(b.total)));
  }

  if (budgets.length) {
    heading("Budgets");
    budgets.forEach((b) =>
      row(`${b.category.name} — ${b.percentUsed}% used`, `${usd(b.spent)} / ${usd(b.limitAmount)}`)
    );
  }

  if (goals.length) {
    heading("Savings jars");
    goals.forEach((g) => row(g.name, `${usd(g.savedAmount)} / ${usd(g.targetAmount)}`));
  }

  if (insight) {
    heading("Monthly insight");
    doc.fontSize(11).fillColor("#111").text(insight.summaryText);
    doc.moveDown(0.3).fillColor(grey).text(insight.tipText);
  }

  doc.moveDown(2).fontSize(9).fillColor(grey).text(
    "Insights and suggestions are advisory and not certified financial advice.",
    { align: "center" }
  );

  doc.end();
  return done;
}
