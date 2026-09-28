import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  } else {
    // No SMTP configured: don't fail, just log the message (dev / demo mode).
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export async function sendMail({ to, subject, text, html, attachments }) {
  const info = await getTransporter().sendMail({
    from: process.env.MAIL_FROM || "Campus Coin <no-reply@campuscoin.app>",
    to,
    subject,
    text,
    html,
    attachments,
  });
  if (!process.env.SMTP_HOST) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}\n`);
  }
  return info;
}

export const appUrl = () => (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
