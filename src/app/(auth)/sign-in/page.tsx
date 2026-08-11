import { redirect } from "next/navigation";
import { SignInForm } from "@/components/forms/sign-in-form";
import { Callout } from "@/components/ui";
import { getCsrfToken, getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect("/");

  const csrfToken = await getCsrfToken();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Persona Builder Studio</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Evidence-backed personas and GEO query-fanout prompt sets.
        </p>
      </div>

      <div className="card p-5">
        <SignInForm csrfToken={csrfToken} />
      </div>

      {!env.isProduction ? (
        <div className="mt-4">
          <Callout tone="info" title="Seeded demo accounts">
            <p>
              <code className="font-mono text-xs">admin@example.com</code> /{" "}
              <code className="font-mono text-xs">demo-password-1</code> — owner
            </p>
            <p>
              <code className="font-mono text-xs">analyst@example.com</code> /{" "}
              <code className="font-mono text-xs">demo-password-2</code> — editor
            </p>
            <p className="mt-1 text-xs">
              Run <code className="font-mono">npm run db:setup</code> if these do not work yet.
            </p>
          </Callout>
        </div>
      ) : null}

      <p className="mt-6 text-xs text-ink-subtle">
        Personas in this product are testable research hypotheses built from evidence. They are not
        real people, digital twins, or a substitute for customer research.
      </p>
    </main>
  );
}
