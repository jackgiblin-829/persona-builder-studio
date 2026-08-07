import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  cn,
} from "@/components/ui";
import { requireBrandAccess } from "@/lib/auth/context";
import {
  comparePersonaVersions,
  FIELD_TYPE_META,
  getPersonaDetail,
  type FieldDiff,
} from "@/services/personas";

export const dynamic = "force-dynamic";

/**
 * Field-level version comparison (§16, §31.15).
 *
 * Fields are matched by statement within their type, so a reworded claim shows
 * as a removal plus an addition rather than a silent edit — which is the honest
 * reading, because the evidence behind the two statements may differ.
 */
export default async function ComparePersonaVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string; personaId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { brandId, personaId } = await params;
  const query = await searchParams;
  const ctx = await requireBrandAccess(brandId);

  const detail = await getPersonaDetail(ctx, personaId);
  const available = detail.versions.map((row) => row.version).sort((a, b) => a - b);

  if (available.length < 2) {
    return (
      <>
        <PageHeader
          title={`Compare versions — ${detail.persona.name}`}
          breadcrumb={`${ctx.brandName} / Personas`}
        />
        <Card>
          <EmptyState
            title="Only one version exists"
            description="Create a second version to compare field by field. Approved versions are never overwritten, so every revision is comparable to the one before it."
            action={
              <Link
                href={`/brands/${brandId}/personas/${personaId}`}
                className="text-sm font-medium text-accent hover:underline"
              >
                Back to the persona
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const parse = (value: string | string[] | undefined, fallback: number) => {
    const raw = typeof value === "string" ? Number(value) : NaN;
    return Number.isInteger(raw) && available.includes(raw) ? raw : fallback;
  };

  const versionA = parse(query.a, available[available.length - 2]!);
  const versionB = parse(query.b, available[available.length - 1]!);

  if (versionA === versionB) {
    return (
      <>
        <PageHeader
          title={`Compare versions — ${detail.persona.name}`}
          breadcrumb={`${ctx.brandName} / Personas`}
        />
        <Callout tone="warn">Choose two different versions to compare.</Callout>
        <div className="mt-3">
          <VersionPicker
            brandId={brandId}
            personaId={personaId}
            available={available}
            a={versionA}
            b={versionB}
          />
        </div>
      </>
    );
  }

  const comparison = await comparePersonaVersions(ctx, personaId, versionA, versionB);
  const changed = comparison.diffs.filter((diff) => diff.change !== "unchanged");

  return (
    <>
      <PageHeader
        title={`Compare versions — ${comparison.persona.name}`}
        description={`Version ${comparison.a.version} (${comparison.a.status}) against version ${comparison.b.version} (${comparison.b.status}).`}
        breadcrumb={
          <>
            {ctx.brandName} /{" "}
            <Link href={`/brands/${brandId}/personas`} className="hover:underline">
              Personas
            </Link>{" "}
            /{" "}
            <Link href={`/brands/${brandId}/personas/${personaId}`} className="hover:underline">
              {comparison.persona.name}
            </Link>
          </>
        }
        actions={
          <ButtonLink href={`/brands/${brandId}/personas/${personaId}`} size="sm">
            Back to persona
          </ButtonLink>
        }
      />

      <div className="mb-4">
        <VersionPicker
          brandId={brandId}
          personaId={personaId}
          available={available}
          a={versionA}
          b={versionB}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Added" value={comparison.summary.added} />
        <Stat label="Removed" value={comparison.summary.removed} />
        <Stat label="Changed" value={comparison.summary.changed} />
        <Stat label="Unchanged" value={comparison.summary.unchanged} />
      </div>

      <Card className="mb-4">
        <CardHeader title="Version metadata" description="Only fields that differ are listed." />
        {comparison.headerDiffs.length === 0 ? (
          <EmptyState
            title="No metadata differences"
            description="The two versions share the same name, status, confidence, definition, model and template."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border text-left text-2xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Field</th>
                  <th className="px-4 py-2 font-semibold">Version {comparison.a.version}</th>
                  <th className="px-4 py-2 font-semibold">Version {comparison.b.version}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {comparison.headerDiffs.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-2 font-medium text-ink">{row.label}</td>
                    <td className="px-4 py-2 text-ink-muted">{row.before}</td>
                    <td className="px-4 py-2 text-ink">{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title={`Field differences (${changed.length})`}
          description="Statements are matched within their field type. A reworded claim appears as a removal and an addition, because the evidence behind it may have changed too."
        />
        {changed.length === 0 ? (
          <EmptyState
            title="No field differences"
            description="Every field, its confidence and its evidence counts are identical across the two versions."
          />
        ) : (
          <ul className="divide-y divide-surface-border">
            {changed.map((diff, index) => (
              <DiffRow
                key={`${diff.fieldType}-${index}`}
                diff={diff}
                versions={[versionA, versionB]}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function DiffRow({ diff, versions }: { diff: FieldDiff; versions: [number, number] }) {
  const tone = diff.change === "added" ? "success" : diff.change === "removed" ? "danger" : "warn";

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{diff.change}</Badge>
        <span className="text-xs font-medium text-ink-muted">
          {FIELD_TYPE_META[diff.fieldType].label}
        </span>
        {diff.changedAspects.length > 0 ? (
          <span className="text-2xs text-ink-subtle">
            differs in: {diff.changedAspects.join(", ")}
          </span>
        ) : null}
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <DiffSide label={`Version ${versions[0]}`} snapshot={diff.before} />
        <DiffSide label={`Version ${versions[1]}`} snapshot={diff.after} />
      </div>
    </li>
  );
}

function DiffSide({ label, snapshot }: { label: string; snapshot: FieldDiff["before"] }) {
  return (
    <div
      className={cn(
        "rounded-md border p-2.5 text-sm",
        snapshot ? "border-surface-border bg-surface" : "border-dashed border-surface-border",
      )}
    >
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      {snapshot ? (
        <>
          <p className="text-ink">{snapshot.statement}</p>
          <p className="mt-1 text-2xs text-ink-subtle">
            {`confidence ${(snapshot.confidence * 100).toFixed(0)}% · ${snapshot.evidenceCount} supporting record${snapshot.evidenceCount === 1 ? "" : "s"}`}
            {snapshot.insufficientEvidence ? " · marked insufficient evidence" : ""}
          </p>
        </>
      ) : (
        <p className="text-ink-subtle">Not present in this version.</p>
      )}
    </div>
  );
}

function VersionPicker({
  brandId,
  personaId,
  available,
  a,
  b,
}: {
  brandId: string;
  personaId: string;
  available: number[];
  a: number;
  b: number;
}) {
  return (
    <Card>
      <CardHeader title="Choose versions" />
      <div className="flex flex-wrap gap-4 px-4 py-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Baseline</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {available.map((version) => (
              <Link
                key={version}
                href={`/brands/${brandId}/personas/${personaId}/compare?a=${version}&b=${b}`}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  version === a
                    ? "bg-accent-soft font-semibold text-accent-ink"
                    : "bg-surface-sunken text-ink-muted hover:text-ink",
                )}
              >
                v{version}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
            Compared to
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {available.map((version) => (
              <Link
                key={version}
                href={`/brands/${brandId}/personas/${personaId}/compare?a=${a}&b=${version}`}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  version === b
                    ? "bg-accent-soft font-semibold text-accent-ink"
                    : "bg-surface-sunken text-ink-muted hover:text-ink",
                )}
              >
                v{version}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
