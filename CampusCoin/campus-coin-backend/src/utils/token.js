import jwt from "jsonwebtoken";
import crypto from "crypto";

export const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });

export const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

export function newResetToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) };
}

export const hashResetToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");
