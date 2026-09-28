import { prisma } from "../db.js";
import { num, money } from "../utils/aggregates.js";
import { cleanStr, toPositiveNumber } from "../utils/validate.js";

// net > 0: others owe you.  net < 0: you owe someone.  Settled = 0.
const shape = (s) => {
  const net = s.settled ? 0 : s.paidByMe ? num(s.totalAmount) - num(s.myShare) : -num(s.myShare);
  return { ...s, net: money(net) };
};

async function own(req, res) {
  const s = await prisma.splitExpense.findUnique({ where: { id: req.params.id } });
  if (!s || s.userId !== req.user.id) { res.status(404).json({ error: "Shared expense not found" }); return null; }
  return s;
}

export async function listSplits(req, res) {
  const rows = await prisma.splitExpense.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" } });
  const splits = rows.map(shape);
  res.json({
    splits,
    summary: {
      youAreOwed: money(splits.filter((s) => s.net > 0).reduce((t, s) => t + s.net, 0)),
      youOwe: money(splits.filter((s) => s.net < 0).reduce((t, s) => t + Math.abs(s.net), 0)),
    },
  });
}

// Body: { title, totalAmount, paidByMe?, participants?: string[], splitCount?, myShare? }
// Equal split by default: total / (participants + you).
export async function createSplit(req, res) {
  const title = cleanStr(req.body.title, 100);
  const totalAmount = toPositiveNumber(req.body.totalAmount);
  const participants = Array.isArray(req.body.participants)
    ? req.body.participants.map((p) => cleanStr(p, 40)).filter(Boolean).slice(0, 20)
    : [];
  const splitCount = participants.length ? participants.length + 1 : Number(req.body.splitCount);

  if (!title || totalAmount === null || !Number.isInteger(splitCount) || splitCount < 2 || splitCount > 21) {
    return res.status(400).json({ error: "A title, a positive totalAmount, and 2+ people (participants or splitCount) are required" });
  }
  let myShare = req.body.myShare !== undefined ? toPositiveNumber(req.body.myShare) : money(totalAmount / splitCount);
  if (myShare === null || myShare > totalAmount) return res.status(400).json({ error: "myShare must be positive and no more than the total" });

  const split = await prisma.splitExpense.create({
    data: {
      userId: req.user.id, title, totalAmount, myShare, splitCount, participants,
      paidByMe: req.body.paidByMe === undefined ? true : !!req.body.paidByMe,
    },
  });
  res.status(201).json({ split: shape(split) });
}

export async function setSettled(req, res) {
  const s = await own(req, res);
  if (!s) return;
  const settled = req.body.settled === undefined ? !s.settled : !!req.body.settled;
  res.json({ split: shape(await prisma.splitExpense.update({ where: { id: s.id }, data: { settled } })) });
}

export async function deleteSplit(req, res) {
  const s = await own(req, res);
  if (!s) return;
  await prisma.splitExpense.delete({ where: { id: s.id } });
  res.status(204).send();
}
