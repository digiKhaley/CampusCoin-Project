import { prisma } from "../db.js";
import { addMonthsKeepDay } from "./dates.js";

// Materialise due recurring transactions (monthly). A recurring "template" is
// just a normal transaction with isRecurring=true and a nextOccurrence date;
// each due occurrence becomes a normal transaction copy.
export async function processRecurring(userId) {
  const now = new Date();
  const due = await prisma.transaction.findMany({
    where: {
      isRecurring: true,
      deletedAt: null,
      nextOccurrence: { lte: now },
      ...(userId ? { userId } : {}),
    },
  });

  for (const t of due) {
    let next = t.nextOccurrence;
    const copies = [];
    let guard = 0;
    while (next <= now && guard < 12) {
      copies.push({
        userId: t.userId,
        categoryId: t.categoryId,
        amount: t.amount,
        type: t.type,
        description: t.description,
        date: next,
        recurringSourceId: t.id,
      });
      next = addMonthsKeepDay(next, 1);
      guard++;
    }
    if (copies.length) {
      await prisma.$transaction([
        prisma.transaction.createMany({ data: copies }),
        prisma.transaction.update({ where: { id: t.id }, data: { nextOccurrence: next } }),
      ]);
    }
  }
  return due.length;
}
