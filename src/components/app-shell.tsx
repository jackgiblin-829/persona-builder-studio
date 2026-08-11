import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/forms/sign-out-button";
import { Badge, BrandIcon, type BrandIconName, cn } from "@/components/ui";
import type { AuthSession } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/rbac";

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
  session,
  organizationId,
  nav,
  currentPath,
  projectName,
  children,
}: {
  session: AuthSession;
  organizationId: string;
  nav: AppNavItem[];
  currentPath: string;
  projectName?: string;
  children: ReactNode;
}) {
  const membership = session.memberships.find((item) => item.organizationId === organizationId);
  const groups = nav.reduce<Record<string, AppNavItem[]>>((result, item) => {
    (result[item.group] ??= []).push(item);
    return result;
  }, {});
  const isActive = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-surface-sunken">
      <div className="mx-auto max-w-[1520px] px-3 pt-3 lg:px-5 lg:pt-5">
        <header className="rounded-2xl bg-ink text-white shadow-[0_18px_44px_rgba(10,0,40,0.12)]">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Link href="/projects" className="text-sm font-semibold text-white">
              829 <span className="ml-2 text-white/70">Persona Builder Studio</span>
            </Link>
            <span className="text-sm text-white/70">
              {membership?.organizationName ?? "Organization"}
            </span>
            {projectName ? (
              <span className="truncate text-sm text-white/70">/ {projectName}</span>
            ) : null}
            <div className="ml-auto flex items-center gap-3">
              {membership ? <RoleBadge role={membership.role} /> : null}
              <span className="hidden text-xs text-white/70 sm:inline">{session.user.email}</span>
              <SignOutButton />
            </div>
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-[1520px] px-3 pt-4 lg:hidden">
        <nav aria-label="Primary" className="flex gap-2 overflow-x-auto pb-1">
          {nav.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} mobile />
          ))}
        </nav>
      </div>

      <div className="mx-auto flex max-w-[1520px] gap-5 px-3 py-5 lg:px-5">
        <nav
          aria-label="Primary"
          className="hidden w-64 shrink-0 self-start rounded-lg border border-surface-border bg-surface p-3 lg:block"
        >
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-5 last:mb-0">
              <p className="mb-1 px-2 text-2xs font-bold uppercase text-ink-subtle">{group}</p>
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={isActive(item.href)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  mobile = false,
}: {
  item: AppNavItem;
  active: boolean;
  mobile?: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2 text-sm transition-colors",
        mobile ? "shrink-0 rounded-full border px-3 py-2" : "rounded-full px-3 py-2",
        active
          ? "border-ink bg-ink font-medium text-white"
          : "border-surface-border text-ink-muted hover:bg-surface-sunken hover:text-ink",
      )}
    >
      {item.icon ? <BrandIcon name={item.icon} className="h-4 w-4" /> : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {!mobile ? (
        <BrandIcon
          name="arrow"
          className={cn(
            "h-3.5 w-3.5",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        />
      ) : null}
    </Link>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone="neutral" title="Your role controls editing and generation access">
      {role}
    </Badge>
  );
}
