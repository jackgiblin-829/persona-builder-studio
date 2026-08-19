"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandIcon, cn } from "@/components/ui";

const TABS = [
  { slug: "data", label: "Data", mobileLabel: "Data", icon: "upload" as const },
  {
    slug: "personas",
    label: "Personas",
    mobileLabel: "Personas",
    icon: "check-circle" as const,
  },
  { slug: "prompts", label: "Prompt Taxonomy", mobileLabel: "Prompts", icon: "list" as const },
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Project workflow"
      className="mb-7 grid grid-cols-3 overflow-hidden rounded-xl border border-surface-border bg-surface p-1"
    >
      {TABS.map((tab, index) => {
        const href = `/projects/${projectId}/${tab.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.slug}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-sm font-medium transition-colors sm:px-4",
              active
                ? "bg-ink text-white shadow-sm"
                : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs",
                active ? "bg-white/15" : "bg-surface-sunken",
              )}
            >
              {index + 1}
            </span>
            <BrandIcon name={tab.icon} className="hidden h-4 w-4 sm:block" />
            <span className="hidden truncate sm:inline">{tab.label}</span>
            <span className="truncate sm:hidden">{tab.mobileLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}
