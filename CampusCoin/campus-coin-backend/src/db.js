import { PrismaClient, Prisma } from "@prisma/client";

// Serialize Decimal columns as plain JSON numbers (instead of strings)
// so the frontend can use amounts directly.
if (Prisma?.Decimal?.prototype) {
  Prisma.Decimal.prototype.toJSON = function toJSON() {
    return this.toNumber();
  };
}

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
