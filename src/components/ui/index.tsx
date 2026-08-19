import type {
  ReactNode,
  CSSProperties,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
} from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export { cn };

// ── 829 brand icons ─────────────────────────────────────────────────────────

export type BrandIconName =
  | "arrow"
  | "arrow-right"
  | "upload"
  | "check-circle"
  | "close"
  | "error"
  | "list"
  | "grid"
  | "menu";

const BRAND_ICON_PATHS: Record<BrandIconName, string> = {
  arrow: "/icons/829/arrow.svg",
  "arrow-right": "/icons/829/arrow-right.svg",
  upload: "/icons/829/upload.svg",
  "check-circle": "/icons/829/check-circle.svg",
  close: "/icons/829/close.svg",
  error: "/icons/829/error.svg",
  list: "/icons/829/list.svg",
  grid: "/icons/829/grid.svg",
  menu: "/icons/829/menu.svg",
};

export function BrandIcon({
  name,
  className,
  "aria-hidden": ariaHidden = true,
}: {
  name: BrandIconName;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={cn("brand-icon", className)}
      style={{ "--brand-icon-url": `url("${BRAND_ICON_PATHS[name]}")` } as CSSProperties}
    />
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "rounded-lg border border-accent bg-accent text-white shadow-sm hover:border-accent-ink hover:bg-accent-ink",
  secondary:
    "rounded-lg border border-surface-border bg-surface text-ink shadow-sm hover:border-ink hover:bg-surface-sunken",
  danger: "rounded-lg border border-danger bg-danger text-white hover:border-ink hover:bg-ink",
  ghost:
    "rounded-none border-0 bg-transparent px-0 text-ink underline decoration-2 underline-offset-4 hover:text-accent",
};

const ICON_BUTTON_VARIANTS: Record<Exclude<ButtonVariant, "ghost">, string> = {
  primary: "rounded-full border border-accent bg-accent text-white hover:bg-accent-ink",
  secondary:
    "rounded-full border border-surface-border bg-surface text-ink hover:border-ink hover:bg-surface-sunken",
  danger: "rounded-full border border-danger bg-danger text-white hover:border-ink hover:bg-ink",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-sm",
  md: "px-5 py-2.5 text-base",
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
      className={cn(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], className)}
    />
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  download,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  download?: string | boolean;
}) {
  const linkClassName = cn(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], className);

  if (download) {
    return (
      <a href={href} download={download} className={linkClassName}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={linkClassName}>
      {children}
    </Link>
  );
}

export function IconButton({
  icon,
  label,
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: BrandIconName;
  label: string;
  variant?: Exclude<ButtonVariant, "ghost">;
  size?: ButtonSize;
}) {
  const dimensions = size === "sm" ? "h-9 w-9" : "h-12 w-12";
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cn(
        BUTTON_BASE,
        dimensions,
        ICON_BUTTON_VARIANTS[variant],
        "rounded-full p-0",
        className,
      )}
    >
      <BrandIcon name={icon} className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </button>
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
          <h1 className="text-2xl font-medium text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export type MetricView = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "accent" | "danger" | "warn" | "success";
};

export function MetricStrip({ metrics, className }: { metrics: MetricView[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-5", className)}>
      {metrics.map((metric) => (
        <Stat
          key={String(metric.label)}
          label={metric.label}
          value={metric.value}
          hint={metric.hint}
          tone={metric.tone}
        />
      ))}
    </div>
  );
}

export type WorkflowStageView = {
  label: string;
  detail?: ReactNode;
  status: "done" | "running" | "waiting" | "empty" | "blocked";
  href?: string;
};

export function WorkflowStepper({ stages }: { stages: WorkflowStageView[] }) {
  return (
    <ol className="divide-y divide-surface-border">
      {stages.map((stage, index) => {
        const icon =
          stage.status === "done"
            ? "check-circle"
            : stage.status === "blocked"
              ? "error"
              : stage.status === "running"
                ? "upload"
                : "arrow-right";
        const tone =
          stage.status === "done"
            ? "text-success"
            : stage.status === "blocked"
              ? "text-danger"
              : stage.status === "running"
                ? "text-accent"
                : "text-ink-subtle";
        const content = (
          <span className="flex w-full items-center gap-3 px-4 py-4 text-left">
            <span className="font-mono text-xs text-ink-subtle">
              {String(index + 1).padStart(2, "0")}
            </span>
            <BrandIcon name={icon} className={cn("h-5 w-5", tone)} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{stage.label}</span>
              {stage.detail ? (
                <span className="mt-0.5 block text-xs text-ink-muted">{stage.detail}</span>
              ) : null}
            </span>
            {stage.href ? <BrandIcon name="arrow" className="h-4 w-4 text-ink-muted" /> : null}
          </span>
        );
        return (
          <li key={stage.label}>
            {stage.href ? (
              <Link href={stage.href} className="block hover:bg-surface-sunken">
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
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
    info: "border-information/30 bg-information-soft text-ink",
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
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-bold uppercase";

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

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "approved" || status === "succeeded" || status === "synced" || status === "completed"
      ? "success"
      : status === "failed" || status === "rejected"
        ? "danger"
        : status === "needs_review" ||
            status === "partially_synced" ||
            status === "partially_succeeded" ||
            status === "completed_with_warnings" ||
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

// ── Misc ────────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "accent" | "danger" | "warn" | "success";
}) {
  const tones = {
    neutral: "border-surface-border",
    accent: "border-accent",
    danger: "border-danger",
    warn: "border-warn",
    success: "border-success",
  } as const;
  return (
    <div className={cn("rounded-lg border-t-2 bg-surface px-3 py-2 shadow-sm", tones[tone])}>
      <p className="text-2xs font-bold uppercase text-ink-muted">{label}</p>
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
      <span className="whitespace-nowrap text-xs tabular-nums text-ink-muted">
        {pct.toFixed(0)}% confidence
      </span>
    </span>
  );
}
