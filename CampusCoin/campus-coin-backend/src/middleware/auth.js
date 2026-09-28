import { verifyToken } from "../utils/token.js";
import { prisma } from "../db.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  let payload;
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return res.status(401).json({ error: "User no longer exists" });
  if (user.isDisabled) {
    return res.status(403).json({ error: "This account has been disabled. Contact an administrator." });
  }

  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin access required" });
  next();
}

// Student-only routes: admin accounts have no student data.
export function requireStudent(req, res, next) {
  if (req.user?.isAdmin) return res.status(403).json({ error: "Not available for administrator accounts" });
  next();
}
