export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (v) => typeof v === "string" && EMAIL_RE.test(v.trim()) && v.length <= 254;
export const normEmail = (v) => String(v || "").trim().toLowerCase();

export function toPositiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function toOptionalMoney(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export const cleanStr = (v, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export const VALID_TYPES = ["income", "expense"];
