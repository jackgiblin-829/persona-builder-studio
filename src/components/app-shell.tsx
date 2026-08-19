import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/forms/sign-out-button";
import { BrandIcon, type BrandIconName, cn } from "@/components/ui";

export type AppNavItem = { href: string; label: string; group: string; icon?: BrandIconName };

export function globalNav(organizationId: string): AppNavItem[] {
  return [
    { href: "/projects", label: "Projects", group: "Studio", icon: "grid" },
    {
      href: `/orgs/${organizationId}/settings/integrations`,
      label: "Integrations",
      group: "Settings",
      icon: "menu",
    },
  ];
}

export function AppShell({
  nav,
  currentPath,
  projectName,
  children,
}: {
  nav: AppNavItem[];
  currentPath: string;
  projectName?: string;
  children: ReactNode;
}) {
  const isActive = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-surface-sunken">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium text-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <header className="border-b border-surface-border bg-surface">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-4 sm:px-6">
          <Link href="/projects" className="shrink-0 text-sm font-semibold text-ink">
            829 <span className="ml-1.5 text-ink-muted">Persona Studio</span>
          </Link>
          {projectName ? (
            <span className="hidden min-w-0 truncate border-l border-surface-border pl-3 text-sm text-ink-muted md:block">
              {projectName}
            </span>
          ) : null}
          <nav aria-label="Primary" className="ml-auto flex items-center gap-1">
            {nav.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </nav>
          <SignOutButton />
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

function NavLink({ item, active }: { item: AppNavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors sm:px-3",
        active
          ? "bg-surface-sunken text-ink"
          : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
      )}
    >
      {item.icon ? <BrandIcon name={item.icon} className="h-4 w-4" /> : null}
      <span className="hidden sm:inline">{item.label}</span>
    </Link>
  );
}
