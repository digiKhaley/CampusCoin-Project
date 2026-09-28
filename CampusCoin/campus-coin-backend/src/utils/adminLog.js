import { prisma } from "../db.js";

export async function adminLog(admin, action) {
  try {
    await prisma.adminLog.create({
      data: { adminId: admin.id, adminEmail: admin.email, action: String(action).slice(0, 300) },
    });
  } catch (err) {
    console.error("adminLog failed:", err.message);
  }
}
