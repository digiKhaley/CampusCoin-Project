import { daysInMonth, monthKey } from "./dates.js";
import { money } from "./aggregates.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Financial health score (0-100) + "safe to spend today".
//  50 pts  savings rate       (20%+ of income saved = full marks)
//  30 pts  budget adherence   (share of budgets not exceeded; 0.8 neutral if none set)
//  20 pts  spending pace      (spend vs. how far through the month we are)
export function computeHealth({ income, expense, budgets, savingsGoal = 0, month, now = new Date() }) {
  const dim = daysInMonth(month);
  const isCurrent = monthKey(month) === now.toISOString().slice(0, 7);
  const day = isCurrent ? now.getUTCDate() : dim;
  const daysLeft = isCurrent ? dim - day + 1 : 0;

  const totalBudget = budgets.reduce((s, b) => s + b.limitAmount, 0);
  const hasData = income > 0 || expense > 0 || budgets.length > 0;

  const savingsRate = income > 0 ? (income - expense) / income : 0;
  const savingsPts = clamp(savingsRate / 0.2, 0, 1);

  const adherence = budgets.length
    ? budgets.filter((b) => b.spent <= b.limitAmount).length / budgets.length
    : 0.8;

  const base = totalBudget > 0 ? totalBudget : income;
  const spentFrac = base > 0 ? expense / base : expense > 0 ? 1 : 0;
  const pacePts = base > 0 ? clamp(1 - Math.max(0, spentFrac - day / dim) * 2, 0, 1) : 0.5;

  const score = hasData ? Math.round(50 * savingsPts + 30 * adherence + 20 * pacePts) : null;

  const pool = totalBudget > 0 ? totalBudget : Math.max(0, income - (savingsGoal || 0));
  const remaining = pool - expense;
  const safeToSpendToday = daysLeft > 0 ? Math.max(0, remaining) / daysLeft : 0;

  return {
    score,
    hasData,
    safeToSpendToday: money(safeToSpendToday),
    remainingToSpend: money(remaining),
    basis: totalBudget > 0 ? "budgets" : "income",
    daysLeft,
  };
}
