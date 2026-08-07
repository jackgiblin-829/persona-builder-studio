import type {
  ReactNode,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
} from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import Link from "next/link";

export function cn(...inputs: Parameters<typeof clsx>): string {
  return twMerge(clsx(inputs));
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-ink",
  secondary: "border border-surface-border bg-surface text-ink hover:bg-surface-sunken",
  danger: "bg-danger text-white hover:brightness-90",
  ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      {...props}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
    />
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
    >
      {children}
    </Link>
  );
}

/**
 * A control the product deliberately does not yet support. Rendered disabled
 * with the reason — never a button that looks functional and does nothing.
 */
export function UnavailableControl({ label, reason }: { label: string; reason: string }) {
  return (
    <span
      className={cn(
        BUTTON_BASE,
        BUTTON_SIZES.sm,
        "cursor-not-allowed border border-dashed border-surface-border text-ink-subtle",
      )}
      title={reason}
      aria-disabled="true"
    >
      {label} — unavailable
    </span>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {breadcrumb ? <div className="mb-1 text-xs text-ink-subtle">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

// ── State displays ──────────────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="max-w-md text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-4 py-3"
    >
      <p className="text-sm font-semibold text-danger">{title}</p>
      <p className="text-sm text-ink">{message}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-10 text-sm text-ink-muted"
      role="status"
      aria-live="polite"
    >
      <span className="h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden />
      {label}
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: "border-accent/30 bg-accent-soft text-ink",
    warn: "border-warn/30 bg-warn-soft text-ink",
    danger: "border-danger/30 bg-danger-soft text-ink",
    success: "border-observed/30 bg-observed-soft text-ink",
  } as const;
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-0.5" : undefined}>{children}</div>
    </div>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────────

const BADGE_BASE =
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide";

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?:
    "neutral" | "observed" | "external" | "inferred" | "accent" | "danger" | "warn" | "success";
  children: ReactNode;
  title?: string;
}) {
  const tones = {
    neutral: "bg-surface-sunken text-ink-muted",
    observed: "bg-observed-soft text-observed",
    external: "bg-external-soft text-external",
    inferred: "bg-inferred-soft text-inferred",
    accent: "bg-accent-soft text-accent-ink",
    danger: "bg-danger-soft text-danger",
    warn: "bg-warn-soft text-warn",
    success: "bg-observed-soft text-observed",
  } as const;
  return (
    <span className={cn(BADGE_BASE, tones[tone])} title={title}>
      {children}
    </span>
  );
}

/** Provenance is a first-class visual. Never render a claim without it. */
export function ProvenanceBadge({ provenance }: { provenance: string }) {
  switch (provenance) {
    case "observed":
      return (
        <Badge tone="observed" title="Directly stated or observed in first-party evidence">
          Observed
        </Badge>
      );
    case "externally_supported":
      return (
        <Badge tone="external" title="Supported by aggregated external audience or search data">
          External
        </Badge>
      );
    case "brand_assertion":
      return (
        <Badge tone="warn" title="The brand's own claim about itself, not customer belief">
          Brand claim
        </Badge>
      );
    default:
      return (
        <Badge tone="inferred" title="Synthesised by a model from evidence — a hypothesis">
          Inferred
        </Badge>
      );
  }
}

/** Where a value came from. Mock data is always visibly mock. */
export function OriginBadge({ origin }: { origin: string }) {
  if (origin === "live")
    return (
      <Badge tone="success" title="Retrieved from a live vendor API">
        Live
      </Badge>
    );
  if (origin === "local")
    return (
      <Badge tone="accent" title="Calculated by this application, not a vendor">
        Local
      </Badge>
    );
  return (
    <Badge tone="warn" title="Deterministic mock data — not from a live vendor API">
      Mock
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "approved" || status === "succeeded" || status === "synced"
      ? "success"
      : status === "failed" || status === "rejected"
        ? "danger"
        : status === "needs_review" ||
            status === "partially_synced" ||
            status === "partially_succeeded" ||
            status === "retrying"
          ? "warn"
          : status === "running" || status === "syncing" || status === "queued"
            ? "accent"
            : "neutral";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}

// ── Form controls ───────────────────────────────────────────────────────────

export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
  error,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  error?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {hint ? <p className="hint mb-1.5">{hint}</p> : <div className="mb-1.5" />}
      {children}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("input", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("input", props.className)} />;
}

export function Checkbox({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        {...props}
        className="mt-0.5 h-4 w-4 rounded border-surface-border text-accent focus:ring-accent"
      />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {hint ? <span className="block text-xs text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

// ── Misc ────────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-surface-border bg-surface px-3 py-2">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tone = pct >= 70 ? "bg-observed" : pct >= 45 ? "bg-external" : "bg-danger";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`Heuristic confidence ${pct.toFixed(0)}%`}
    >
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs tabular-nums text-ink-muted">{pct.toFixed(0)}</span>
    </span>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">
            {item.label}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Chips({
  values,
  tone = "neutral",
}: {
  values: string[];
  tone?: "neutral" | "accent";
}) {
  if (values.length === 0) return <span className="text-sm text-ink-subtle">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <span
          key={value}
          className={cn(
            "rounded px-1.5 py-0.5 text-xs",
            tone === "accent"
              ? "bg-accent-soft text-accent-ink"
              : "bg-surface-sunken text-ink-muted",
          )}
        >
          {value}
        </span>
      ))}
    </span>
  );
}
