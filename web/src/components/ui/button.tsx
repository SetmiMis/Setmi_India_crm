import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap";
const variants: Record<Variant, string> = {
  primary: "bg-cyan text-white hover:bg-cyan-dk shadow-sm",
  secondary: "bg-panel text-ink border border-line hover:bg-chip",
  ghost: "text-ink hover:bg-chip",
  danger: "bg-red text-white hover:brightness-95",
  success: "bg-green text-white hover:bg-green-dk",
};
const sizes: Record<Size, string> = { sm: "text-[12.5px] px-2.5 py-1.5", md: "text-sm px-3.5 py-2" };

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
