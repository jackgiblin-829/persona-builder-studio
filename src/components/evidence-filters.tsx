"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Button, Card, Input, Select, cn } from "@/components/ui";

export type EvidenceFacets = {
  categories: { value: string; n: number }[];
  stages: { value: string; n: number }[];
  sources: { id: string; label: string; sourceType: string }[];
  entities: { value: string; n: number }[];
  segments: { value: string; n: number }[];
};

const PROVENANCE_OPTIONS = [
  { value: "observed", label: "Observed" },
  { value: "externally_supported", label: "Externally supported" },
  { value: "brand_assertion", label: "Brand assertion" },
  { value: "inferred", label: "Inferred" },
];

const SENTIMENT_OPTIONS = ["positive", "neutral", "negative", "concern", "mixed", "unknown"];
const REVIEW_OPTIONS = ["pending_review", "approved", "rejected", "needs_review"];

/**
 * All eleven filters from §10, driven through the URL so a filtered view is
 * shareable and the back button behaves.
 */
export function EvidenceFilters({
  brandId,
  facets,
  current,
}: {
  brandId: string;
  facets: EvidenceFacets;
  current: Record<string, unknown>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeCount = useMemo(
    () =>
      [...searchParams.keys()].filter(
        (key) => !["page", "pageSize", "searchMode"].includes(key) && searchParams.get(key),
      ).length,
    [searchParams],
  );

  const apply = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("page");
      router.push(`/brands/${brandId}/evidence?${next.toString()}`);
    },
    [brandId, router, searchParams],
  );

  const value = (key: string) => String(current[key] ?? "");

  return (
    <Card className="p-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          apply({
            q: String(data.get("q") ?? ""),
            searchMode: String(data.get("searchMode") ?? "text"),
          });
        }}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        <div className="min-w-[240px] flex-1">
          <label className="label" htmlFor="q">
            Search
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={value("q")}
            placeholder="e.g. data cannot leave our cloud"
            className="mt-1"
          />
        </div>
        <div>
          <label className="label" htmlFor="searchMode">
            Mode
          </label>
          <Select
            id="searchMode"
            name="searchMode"
            defaultValue={value("searchMode") || "text"}
            className="mt-1"
          >
            <option value="text">Full text</option>
            <option value="semantic">Semantic</option>
          </Select>
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
        {activeCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/brands/${brandId}/evidence`)}
          >
            Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </Button>
        ) : null}
      </form>

      <div className={cn("grid gap-2", "sm:grid-cols-3 lg:grid-cols-5")}>
        <FilterSelect
          label="Source"
          name="sourceId"
          value={value("sourceId")}
          onChange={apply}
          options={facets.sources.map((s) => ({ value: s.id, label: s.label }))}
        />
        <FilterSelect
          label="Category"
          name="category"
          value={value("category")}
          onChange={apply}
          options={facets.categories.map((c) => ({
            value: c.value,
            label: `${c.value.replace(/_/g, " ")} (${c.n})`,
          }))}
        />
        <FilterSelect
          label="Provenance"
          name="provenance"
          value={value("provenance")}
          onChange={apply}
          options={PROVENANCE_OPTIONS}
        />
        <FilterSelect
          label="Journey stage"
          name="journeyStage"
          value={value("journeyStage")}
          onChange={apply}
          options={facets.stages.map((s) => ({
            value: s.value,
            label: `${s.value.replace(/_/g, " ")} (${s.n})`,
          }))}
        />
        <FilterSelect
          label="Sentiment"
          name="sentiment"
          value={value("sentiment")}
          onChange={apply}
          options={SENTIMENT_OPTIONS.map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          label="Review status"
          name="reviewStatus"
          value={value("reviewStatus")}
          onChange={apply}
          options={REVIEW_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
        />
        <FilterSelect
          label="Entity"
          name="entity"
          value={value("entity")}
          onChange={apply}
          options={facets.entities.map((e) => ({ value: e.value, label: `${e.value} (${e.n})` }))}
        />
        <FilterSelect
          label="Segment label"
          name="segmentLabel"
          value={value("segmentLabel")}
          onChange={apply}
          options={facets.segments.map((s) => ({ value: s.value, label: `${s.value} (${s.n})` }))}
        />
        <div>
          <label className="label text-xs" htmlFor="observedFrom">
            Observed from
          </label>
          <Input
            id="observedFrom"
            type="date"
            defaultValue={value("observedFrom")}
            onChange={(event) => apply({ observedFrom: event.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <label className="label text-xs" htmlFor="observedTo">
            Observed to
          </label>
          <Input
            id="observedTo"
            type="date"
            defaultValue={value("observedTo")}
            onChange={(event) => apply({ observedTo: event.target.value })}
            className="mt-1"
          />
        </div>
      </div>
    </Card>
  );
}

function FilterSelect({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (updates: Record<string, string>) => void;
}) {
  return (
    <div>
      <label className="label text-xs" htmlFor={name}>
        {label}
      </label>
      <Select
        id={name}
        value={value}
        onChange={(event) => onChange({ [name]: event.target.value })}
        className="mt-1"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
