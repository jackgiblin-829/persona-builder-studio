"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction } from "@/app/actions/auth";
import { IDLE } from "@/app/actions/state";
import { Button, ErrorState, Field, Input } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/auth/constants";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function SignInForm({ csrfToken }: { csrfToken: string }) {
  const [state, formAction] = useActionState(signInAction, IDLE);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />

      {state.status === "error" && state.message ? (
        <ErrorState title="Could not sign in" message={state.message} />
      ) : null}

      <Field label="Email" htmlFor="email" required error={state.fieldErrors?.email?.[0]}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@example.com"
        />
      </Field>

      <Field label="Password" htmlFor="password" required error={state.fieldErrors?.password?.[0]}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
