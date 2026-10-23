import { z } from "zod";
import { CALL_STATUSES, ESCALATIONS, INTEREST_LEVELS, PRIORITIES, STAGES, TIMELINES } from "./constants";

// Same rules as the database (private.validate_contact). Validating here gives instant,
// field-level messages; the database re-validates, so a bypassed form gains nothing.

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => trimmed(max).optional().default("");

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => {
    const digits = v.replace(/\D/g, "");
    return digits.length === 10 || (digits.length === 12 && digits.startsWith("91")) || (digits.length === 11 && digits.startsWith("0"));
  }, "Enter a 10-digit mobile number");

export const emailSchema = z.union([z.literal(""), z.email("Invalid email").max(120)]);
export const pincodeSchema = z.union([z.literal(""), z.string().regex(/^\d{6}$/, "Pincode must be 6 digits")]);
export const gstSchema = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN"),
]);

const optionalNumber = z
  .union([z.literal(""), z.coerce.number().min(0, "Must be 0 or more").max(1e12)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.literal(""), z.enum(values)])
    .optional()
    .transform((v) => (v ? v : null));

export const contactFields = {
  customer_name: trimmed(120).min(1, "Customer name is required"),
  company: optionalText(120),
  phone: phoneSchema,
  email: emailSchema.optional().default(""),
  gst: gstSchema.optional().default(""),
  pincode: pincodeSchema.optional().default(""),
  district: optionalText(80),
  state: optionalText(80),
  city: optionalText(80),
};

export const pendingEnquirySchema = z.object({
  ...contactFields,
  source: optionalText(40),
  priority: optionalEnum(PRIORITIES),
  owner_id: z.union([z.literal(""), z.uuid()]).optional().default(""),
  est_value: optionalNumber,
  requirement: optionalText(1000),
  qty: optionalNumber,
  timeline: optionalEnum(TIMELINES),
  notes: optionalText(4000),
});
export type PendingEnquiryInput = z.infer<typeof pendingEnquirySchema>;

// Public field form: deliberately narrower (no owner, priority, source, value, notes).
export const publicEnquirySchema = z.object({
  ...contactFields,
  requirement: trimmed(1000).min(3, "Tell us what you need"),
  qty: optionalNumber,
  timeline: optionalEnum(TIMELINES),
  // Honeypot: real people never fill this hidden field.
  website: z.string().max(0, "Invalid submission").optional().default(""),
  form_token: z.string().min(16).max(100),
});

export const enquiryEditSchema = z.object({
  ...contactFields,
  source: optionalText(40),
  requirement: optionalText(1000),
  est_value: optionalNumber,
  quote_amount: optionalNumber,
  order_value: optionalNumber,
  shipment_weight: optionalNumber,
  priority: optionalEnum(PRIORITIES),
  next_follow_up: z.union([z.literal(""), z.iso.date()]).optional().default(""),
  qty: optionalNumber,
  timeline: optionalEnum(TIMELINES),
  escalation: optionalEnum(ESCALATIONS),
  owner_id: z.union([z.literal(""), z.uuid()]).optional(),
  version: z.coerce.number().int().min(1),
});

export const stageMoveSchema = z
  .object({
    stage: z.enum(STAGES),
    version: z.coerce.number().int().min(1),
    note: optionalText(1000),
    quote_no: optionalText(60),
    quote_amount: optionalNumber,
    invoice_no: optionalText(60),
    order_value: optionalNumber,
    lost_reason: optionalText(500),
    dispatch_date: z.union([z.literal(""), z.iso.date()]).optional().default(""),
    dispatch_info: optionalText(500),
    shipment_weight: optionalNumber,
    feedback_rating: z.union([z.literal(""), z.coerce.number().int().min(1).max(5)]).optional().default(""),
    feedback_note: optionalText(1000),
    next_follow_up: z.union([z.literal(""), z.iso.date()]).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.stage === "Won" && !v.invoice_no) ctx.addIssue({ code: "custom", path: ["invoice_no"], message: "Invoice number is required" });
    if (v.stage === "Lost" && !v.lost_reason) ctx.addIssue({ code: "custom", path: ["lost_reason"], message: "Lost reason is required" });
  });

export const callLogSchema = z
  .object({
    call_status: z.enum(CALL_STATUSES, { message: "Pick a call status" }),
    interest: optionalEnum(INTEREST_LEVELS),
    remarks: optionalText(1000),
    call_date: z.union([z.literal(""), z.iso.date()]).optional().default(""),
    next_follow_up: z.union([z.literal(""), z.iso.date()]).optional().default(""),
    client_request_id: z.uuid(),
  })
  .transform((v) => ({ ...v, interest: v.call_status === "Connected" ? v.interest : null }));

export const customerSchema = z.object({
  name: trimmed(120).min(1, "Name is required"),
  company: optionalText(120),
  phone: phoneSchema,
  email: emailSchema.optional().default(""),
  gst: gstSchema.optional().default(""),
  pincode: pincodeSchema.optional().default(""),
  district: optionalText(80),
  state: optionalText(80),
  city: optionalText(80),
  notes: optionalText(2000),
});

export const newUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, "3–40 characters: a–z, 0–9, . _ -"),
  full_name: trimmed(80).min(1, "Name is required"),
  email: z.email("A valid email is needed for sign-in and password reset"),
  password: z.string().min(10, "At least 10 characters").max(128),
  role: z.enum(["admin", "rep"]),
});

export const passwordSchema = z
  .string()
  .min(10, "At least 10 characters")
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use letters and numbers");

/** Flatten zod issues into { field: message } for forms. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
