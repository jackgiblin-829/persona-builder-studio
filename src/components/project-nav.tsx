"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandIcon, cn } from "@/components/ui";

const TABS = [
  { slug: "data", label: "Data", icon: "upload" as const },
  { slug: "personas", label: "Personas", icon: "check-circle" as const },
  { slug: "prompts", label: "Prompts", icon: "list" as const },
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Project workflow" className="mb-5 flex gap-2 overflow-x-auto">
      {TABS.map((tab, index) => {
        const href = `/projects/${projectId}/${tab.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.slug}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium",
              active
                ? "border-ink bg-ink text-white"
                : "border-surface-border bg-surface text-ink-muted hover:border-ink hover:text-ink",
            )}
          >
            <span className="text-xs opacity-70">{index + 1}</span>
            <BrandIcon name={tab.icon} className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
