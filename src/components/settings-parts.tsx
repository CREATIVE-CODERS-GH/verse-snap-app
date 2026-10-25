import type { ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/stitch-icons";
import { cn } from "@/lib/utils";

/*
 * Shared pieces for Settings (Stitch 11) and its sub-screens Text Size (17) and Voice & Audio (18),
 * drawn with the shared theme tokens so they follow light and dark mode.
 */

/** A row in the main Settings list: icon, label, current value and a chevron. */
export function SettingsRow({
  icon,
  label,
  value,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  value?: string | undefined;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex min-h-14 w-full items-center gap-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
      >
        <span
          className={cn("shrink-0", danger ? "text-brand-danger" : "text-brand-text-muted")}
          aria-hidden
        >
          {icon}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[15px]",
            danger ? "text-brand-danger" : "text-brand-text",
          )}
        >
          {label}
        </span>
        {value ? (
          <span className="max-w-[45%] truncate text-[14px] text-brand-text-muted">{value}</span>
        ) : null}
        <ChevronRightIcon
          className="h-5 w-5 shrink-0 text-brand-text-faint transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
    </li>
  );
}

/** Back button and centred title for a settings sub-screen. */
export function SubScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="sticky top-0 z-20 -mx-6 flex items-center bg-brand-canvas/90 px-6 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-md">
      <button
        type="button"
        aria-label="Back to Settings"
        onClick={onBack}
        className="relative z-10 -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-brand-text transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
      >
        <ChevronLeftIcon className="h-6 w-6" strokeWidth={2.2} />
      </button>
      <h1 className="pointer-events-none absolute inset-x-0 text-center text-[17px] font-semibold tracking-tight text-brand-text">
        {title}
      </h1>
    </header>
  );
}

/** Small uppercase section label, with an optional tag on the right ("Instant update"). */
export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-text-muted">
        {children}
      </h2>
      {aside ? (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-gold-text">
          {aside}
        </span>
      ) : null}
    </div>
  );
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-brand-border bg-brand-surface p-4 shadow-sm",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A row of mutually exclusive options, as a radio group. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode; hint?: string; aria?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 rounded-xl bg-brand-surface-muted p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.aria}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center rounded-lg px-1 py-1.5 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
              active
                ? "bg-brand-primary text-brand-on-primary shadow-sm"
                : "text-brand-text hover:bg-brand-surface-sunken",
            )}
          >
            <span className="text-[14px] font-semibold leading-tight">{option.label}</span>
            {option.hint ? (
              <span
                className={cn(
                  "text-[10.5px] leading-tight",
                  active ? "text-brand-on-primary/80" : "text-brand-text-muted",
                )}
              >
                {option.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A selectable card (typeface, line spacing, narrator). */
export function OptionCard({
  selected,
  onSelect,
  title,
  subtitle,
  badge,
  preview,
  indicator = "radio",
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  badge?: string;
  preview?: ReactNode;
  indicator?: "radio" | "none";
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
        selected
          ? "border-brand-primary bg-brand-primary-soft"
          : "border-brand-border bg-brand-surface hover:bg-brand-surface-muted",
      )}
    >
      {preview}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-brand-text">{title}</span>
          {badge ? (
            <span className="rounded-full bg-brand-gold-soft px-2 py-0.5 text-[10.5px] font-semibold text-brand-gold-text">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-brand-text-muted">
          {subtitle}
        </span>
      </span>
      {indicator === "radio" ? (
        <span
          aria-hidden
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
            selected ? "border-brand-primary" : "border-brand-border-strong",
          )}
        >
          {selected ? <span className="h-2.5 w-2.5 rounded-full bg-brand-primary" /> : null}
        </span>
      ) : null}
    </button>
  );
}

/** An on/off switch with its label and hint. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-brand-text">{label}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-brand-text-muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-surface",
          checked ? "bg-brand-primary" : "bg-brand-surface-stronger",
        )}
      >
        <span
          className={cn(
            "block h-6 w-6 rounded-full shadow-sm transition-transform",
            checked ? "translate-x-5 bg-brand-on-primary" : "translate-x-0 bg-brand-surface",
          )}
        />
      </button>
    </div>
  );
}
