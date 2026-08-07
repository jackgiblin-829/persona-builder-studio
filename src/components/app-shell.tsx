import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/forms/sign-out-button";
import { Badge, cn } from "@/components/ui";
import type { AuthSession } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/rbac";

export type BrandNavItem = { href: string; label: string; group: string };

export function brandNav(brandId: string): BrandNavItem[] {
  const base = `/brands/${brandId}`;
  return [
    { href: `${base}`, label: "Overview", group: "Brand" },
    { href: `${base}/setup`, label: "Setup", group: "Brand" },
    { href: `${base}/sources`, label: "Data sources", group: "Evidence" },
    { href: `${base}/evidence`, label: "Evidence explorer", group: "Evidence" },
    { href: `${base}/research/sparktoro`, label: "SparkToro research", group: "Evidence" },
    { href: `${base}/research/dataforseo`, label: "DataForSEO research", group: "Evidence" },
    { href: `${base}/segments`, label: "Candidate segments", group: "Personas" },
    { href: `${base}/personas`, label: "Personas", group: "Personas" },
    { href: `${base}/prompt-sets`, label: "Prompt sets", group: "Prompts" },
    { href: `${base}/profound/export`, label: "Export & reconcile", group: "Profound" },
    { href: `${base}/profound/performance`, label: "Persona performance", group: "Profound" },
    { href: `${base}/opportunities`, label: "Content opportunities", group: "Content" },
    { href: `${base}/briefs`, label: "SEO briefs", group: "Content" },
    { href: `${base}/audits`, label: "Page audits", group: "Content" },
    { href: `${base}/jobs`, label: "Job status", group: "Operations" },
    { href: `${base}/evaluations`, label: "Evaluations", group: "Operations" },
  ];
}

export function orgNav(orgId: string): BrandNavItem[] {
  return [
    { href: `/orgs/${orgId}/brands`, label: "Brands", group: "Organization" },
    { href: `/orgs/${orgId}/settings/integrations`, label: "Integrations", group: "Organization" },
    { href: `/orgs/${orgId}/settings/usage`, label: "Vendor usage & cost", group: "Organization" },
    { href: `/orgs/${orgId}/settings`, label: "Settings", group: "Organization" },
  ];
}

export function AppShell({
  session,
  organizationId,
  nav,
  currentPath,
  brandName,
  children,
}: {
  session: AuthSession;
  organizationId: string;
  nav: BrandNavItem[];
  currentPath: string;
  brandName?: string;
  children: ReactNode;
}) {
  const membership = session.memberships.find((m) => m.organizationId === organizationId);
  const groups = nav.reduce<Record<string, BrandNavItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-screen">
      <header className="border-b border-surface-border bg-surface">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-2.5">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Persona Evidence Studio
          </Link>

          <OrgSwitcher session={session} currentOrganizationId={organizationId} />

          {brandName ? (
            <span className="truncate text-sm text-ink-muted">
              <span aria-hidden className="mx-1 text-ink-subtle">
                /
              </span>
              {brandName}
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            {membership ? <RoleBadge role={membership.role} /> : null}
            <span className="hidden text-xs text-ink-muted sm:inline">{session.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6">
        <nav aria-label="Section" className="hidden w-56 shrink-0 lg:block">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-5">
              <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                {group}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active =
                    currentPath === item.href ||
                    (item.href !== `/brands/${item.href.split("/")[2]}` &&
                      currentPath.startsWith(`${item.href}/`));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block rounded px-2 py-1.5 text-sm transition-colors",
                          active
                            ? "bg-accent-soft font-medium text-accent-ink"
                            : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone="neutral" title="Your role in this organization determines what you can do">
      {role}
    </Badge>
  );
}

function OrgSwitcher({
  session,
  currentOrganizationId,
}: {
  session: AuthSession;
  currentOrganizationId: string;
}) {
  const current = session.memberships.find((m) => m.organizationId === currentOrganizationId);
  if (session.memberships.length <= 1) {
    return <span className="text-sm text-ink-muted">{current?.organizationName ?? "—"}</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <span aria-hidden className="text-ink-subtle">
        /
      </span>
      <details className="relative">
        <summary className="cursor-pointer list-none rounded px-1.5 py-0.5 text-sm text-ink hover:bg-surface-sunken">
          {current?.organizationName ?? "Select organization"}
        </summary>
        <ul className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-surface-border bg-surface py-1 shadow-lg">
          {session.memberships.map((m) => (
            <li key={m.organizationId}>
              <Link
                href={`/orgs/${m.organizationId}/brands`}
                className="block px-3 py-1.5 text-sm hover:bg-surface-sunken"
              >
                {m.organizationName}
                <span className="ml-1 text-xs text-ink-subtle">({m.role})</span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
