import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  name,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="field-label">
        {label}
        {required ? <span className="text-red"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ error, className, ...props }: ComponentProps<"input"> & { error?: string }) {
  return (
    <input
      id={props.id ?? props.name}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${props.name}-error` : undefined}
      className={cn("input", className)}
      {...props}
    />
  );
}

export function Textarea({ error, className, ...props }: ComponentProps<"textarea"> & { error?: string }) {
  return (
    <textarea
      id={props.id ?? props.name}
      aria-invalid={error ? true : undefined}
      className={cn("input min-h-[76px]", className)}
      {...props}
    />
  );
}

export function Select({
  options,
  placeholder,
  error,
  className,
  ...props
}: ComponentProps<"select"> & {
  options: ReadonlyArray<string | { value: string; label: string }>;
  placeholder?: string;
  error?: string;
}) {
  return (
    <select id={props.id ?? props.name} aria-invalid={error ? true : undefined} className={cn("input", className)} {...props}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => {
        const v = typeof o === "string" ? { value: o, label: o } : o;
        return (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        );
      })}
    </select>
  );
}
