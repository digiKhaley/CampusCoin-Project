import { prisma } from "../db.js";
import { hashPassword, comparePassword, passwordProblem } from "../utils/password.js";
import { signToken, newResetToken, hashResetToken } from "../utils/token.js";
import { sendMail, appUrl } from "../utils/mailer.js";
import { adminLog } from "../utils/adminLog.js";
import { isEmail, normEmail, cleanStr, toOptionalMoney } from "../utils/validate.js";

const FALLBACK_DEFAULTS = [
  ["Allowance", "income"], ["Part-time Job", "income"], ["Scholarship", "income"],
  ["Gift", "income"], ["Other Income", "income"],
  ["Food", "expense"], ["Transport", "expense"], ["Hostel/Rent", "expense"],
  ["Academics", "expense"], ["Subscriptions", "expense"], ["Entertainment", "expense"],
  ["Miscellaneous", "expense"],
].map(([name, type]) => ({ name, type }));

export function publicUser(u) {
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, ...safe } = u;
  return safe;
}

export async function register(req, res) {
  const name = cleanStr(req.body.name, 100);
  const email = normEmail(req.body.email);
  const { password } = req.body;

  if (!name || !isEmail(email) || !password) {
    return res.status(400).json({ error: "A name, a valid email, and a password are required" });
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) return res.status(400).json({ error: pwProblem });

  const allowance = toOptionalMoney(req.body.monthlyAllowance);
  const goal = toOptionalMoney(req.body.monthlySavingsGoal);
  if (allowance === null || goal === null) {
    return res.status(400).json({ error: "Allowance and savings goal must be zero or positive numbers" });
  }

  if (await prisma.user.findUnique({ where: { email } })) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  // Admin-managed defaults; falls back to the SRS baseline list if not seeded.
  const defaults = await prisma.defaultCategory.findMany();
  const source = defaults.length ? defaults : FALLBACK_DEFAULTS;

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      academicYear: cleanStr(req.body.academicYear, 40) || null,
      monthlyAllowance: allowance ?? null,
      monthlySavingsGoal: goal ?? null,
      lastLoginAt: new Date(),
      categories: { create: source.map((c) => ({ name: c.name, type: c.type, isDefault: true })) },
    },
  });

  res.status(201).json({ token: signToken({ sub: user.id, role: "student" }), user: publicUser(user) });
}

// Student login. Admin accounts must use /admin/login (SRS: separate admin login).
export async function login(req, res) {
  const email = normEmail(req.body.email);
  const { password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user && !user.isAdmin && (await comparePassword(password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });
  if (user.isDisabled) {
    return res.status(403).json({ error: "This account has been disabled. Contact an administrator." });
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  res.json({ token: signToken({ sub: user.id, role: "student" }), user: publicUser(updated) });
}

export async function adminLogin(req, res) {
  const email = normEmail(req.body.email);
  const { password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user && user.isAdmin && !user.isDisabled && (await comparePassword(password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Invalid administrator credentials" });

  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await adminLog(user, "Admin signed in");
  res.json({ token: signToken({ sub: user.id, role: "admin" }), user: publicUser(updated) });
}

// Tokens are stateless, so "logout" is client-side; this endpoint records admin
// sign-outs in the activity log and is a harmless no-op for students.
export async function logout(req, res) {
  if (req.user.isAdmin) await adminLog(req.user, "Admin signed out");
  res.status(204).send();
}

export async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

export async function updateProfile(req, res) {
  const data = {};
  if (req.body.name !== undefined) {
    const name = cleanStr(req.body.name, 100);
    if (!name) return res.status(400).json({ error: "Name can't be empty" });
    data.name = name;
  }
  if (req.body.academicYear !== undefined) data.academicYear = cleanStr(req.body.academicYear, 40) || null;

  for (const field of ["monthlyAllowance", "monthlySavingsGoal"]) {
    if (req.body[field] !== undefined) {
      const v = toOptionalMoney(req.body[field]);
      if (v === null) return res.status(400).json({ error: `${field} must be zero or a positive number` });
      data[field] = v ?? null;
    }
  }

  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ user: publicUser(user) });
}

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (!(await comparePassword(currentPassword, req.user.passwordHash))) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  res.json({ message: "Password updated" });
}

export async function issueResetEmail(user) {
  const { raw, hash, expiresAt } = newResetToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { resetTokenHash: hash, resetTokenExpiresAt: expiresAt },
  });
  const link = `${appUrl()}/?reset_token=${raw}&email=${encodeURIComponent(user.email)}`;
  await sendMail({
    to: user.email,
    subject: "Reset your Campus Coin password",
    text: `Hi ${user.name},\n\nUse this link to set a new password (valid for 30 minutes):\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: `<p>Hi ${user.name},</p><p><a href="${link}">Set a new password</a> (valid for 30 minutes).</p><p>If you didn't ask for this, you can ignore this email.</p>`,
  });
}

export async function forgotPassword(req, res) {
  const email = normEmail(req.body.email);
  if (!isEmail(email)) return res.status(400).json({ error: "A valid email is required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.isDisabled) await issueResetEmail(user);

  // Same response either way so this can't be used to discover registered emails.
  res.json({ message: "If that email exists, a reset link has been sent" });
}

export async function resetPassword(req, res) {
  const email = normEmail(req.body.email);
  const { token, newPassword } = req.body;
  if (!email || !token || !newPassword) {
    return res.status(400).json({ error: "email, token, and newPassword are required" });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  const user = await prisma.user.findUnique({ where: { email } });
  const valid =
    user &&
    user.resetTokenHash === hashResetToken(String(token)) &&
    user.resetTokenExpiresAt &&
    user.resetTokenExpiresAt > new Date();
  if (!valid) return res.status(400).json({ error: "Invalid or expired reset token" });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), resetTokenHash: null, resetTokenExpiresAt: null },
  });
  res.json({ message: "Password updated. You can now log in." });
}
