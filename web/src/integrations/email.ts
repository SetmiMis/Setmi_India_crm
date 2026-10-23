import "server-only";
import nodemailer from "nodemailer";
import { env, isConfigured } from "@/lib/env";

// SMTP sender (Hostinger mailboxes provide SMTP). In tests or without SMTP settings nothing is sent.
export async function sendEmail(msg: { to: string[]; subject: string; html: string; text: string }): Promise<{ sent: boolean; reason?: string }> {
  if (process.env.NODE_ENV === "test" || process.env.EMAIL_DISABLED === "true") return { sent: false, reason: "disabled" };
  if (!isConfigured("smtp")) return { sent: false, reason: "SMTP not configured" };
  if (msg.to.length === 0) return { sent: false, reason: "no recipients" };
  const e = env();
  const transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT ?? 465,
    secure: (e.SMTP_PORT ?? 465) === 465,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15000,
  });
  await transport.sendMail({ from: e.SMTP_FROM, to: msg.to.join(", "), subject: msg.subject, html: msg.html, text: msg.text });
  return { sent: true };
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
