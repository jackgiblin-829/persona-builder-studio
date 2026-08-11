import Link from "next/link";
import { Badge, ProvenanceBadge } from "@/components/ui";

export type EvidenceTableRow = {
  id: string;
  relation: "supports" | "contradicts";
  normalizedClaim: string;
  redactedText: string;
  category: string;
  provenance: string;
  journeyStage: string;
  sourceLabel: string;
  sourceLocation: string;
  availability: string;
  observedAt: Date | null;
};

export function EvidenceTable({ brandId, rows }: { brandId: string; rows: EvidenceTableRow[] }) {
  return (
    <ul className="divide-y divide-surface-border">
      {rows.map((row) => (
        <li key={`${row.id}-${row.relation}`} className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link
              href={`/brands/${brandId}/evidence/${row.id}`}
              className="min-w-0 flex-1 text-sm font-medium text-ink hover:text-accent hover:underline"
            >
              {row.normalizedClaim}
            </Link>
            <div className="flex flex-wrap items-center gap-1">
              <ProvenanceBadge provenance={row.provenance} />
              <Badge tone="neutral">{row.category.replace(/_/g, " ")}</Badge>
              {row.availability !== "available" ? (
                <Badge tone="danger" title="Source deleted; excluded from confidence">
                  unavailable
                </Badge>
              ) : null}
            </div>
          </div>
          <p className="mt-1 line-clamp-2 text-sm italic text-ink-muted">“{row.redactedText}”</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-subtle">
            <span>{row.sourceLabel}</span>
            <span>· {row.sourceLocation}</span>
            <span>· {row.journeyStage.replace(/_/g, " ")}</span>
            {row.observedAt ? <span>· {row.observedAt.toISOString().slice(0, 10)}</span> : null}
            <code>{row.id}</code>
          </div>
        </li>
      ))}
    </ul>
  );
}
