"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { IDLE, type ActionState } from "@/app/actions/state";
import { Button, Callout, ErrorState, cn, IconButton, type BrandIconName } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/auth/constants";

export type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({
  label,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  confirm,
  name,
  value,
  form,
  disabled = false,
}: {
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
  confirm?: string;
  /** Submitted alongside the form data — lets one form carry several operations. */
  name?: string;
  value?: string;
  /** Associates the button with a form it is not nested inside. */
  form?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending || disabled}
      className={className}
      name={name}
      value={value}
      form={form}
      onClick={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
    >
      {pending ? (pendingLabel ?? "Working…") : label}
    </Button>
  );
}

export function SubmitIconButton({
  icon,
  label,
  pendingLabel,
  variant = "danger",
  size = "sm",
  className,
  confirm,
  disabled = false,
}: {
  icon: BrandIconName;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
  className?: string;
  confirm?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <IconButton
      type="submit"
      icon={icon}
      label={pending ? (pendingLabel ?? "Working…") : label}
      variant={variant}
      size={size}
      disabled={pending || disabled}
      className={className}
      onClick={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
    />
  );
}

/**
 * Wraps a server action with CSRF, hidden fields, and inline success/error
 * feedback. Every mutating form in the product uses this so no control can
 * silently do nothing.
 */
export function ActionForm({
  action,
  csrfToken,
  hidden = {},
  className,
  children,
  successTone = "success",
  onSuccessMessage,
  id,
}: {
  action: ServerAction;
  csrfToken: string;
  hidden?: Record<string, string | number | undefined | null>;
  className?: string;
  children: ReactNode;
  successTone?: "success" | "info";
  onSuccessMessage?: (state: ActionState) => ReactNode;
  /** Lets inputs elsewhere on the page join this form via their `form` attribute. */
  id?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);

  return (
    <form id={id} action={formAction} className={cn("space-y-3", className)}>
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      {Object.entries(hidden).map(([name, value]) =>
        value === undefined || value === null ? null : (
          <input key={name} type="hidden" name={name} value={String(value)} />
        ),
      )}

      {state.status === "error" && state.message ? (
        <ErrorState title="Action failed" message={state.message} />
      ) : null}
      {state.status === "ok" && (state.message || onSuccessMessage) ? (
        <Callout tone={successTone}>{onSuccessMessage?.(state) ?? state.message}</Callout>
      ) : null}

      {children}
    </form>
  );
}
