import { Badge, ConfidenceBar, cn } from "@/components/ui";
import {
  COMPONENT_LABELS,
  COMPONENT_WEIGHT_LABELS,
  CONFIDENCE_COMPONENT_KEYS,
  type ConfidenceComponentKey,
} from "@/lib/confidence";

/**
 * Renders every confidence component, not just the score (§15).
 *
 * The weight is shown next to each component so a reviewer can see why a number
 * moved, and the whole panel is labelled a heuristic rather than a probability —
 * the distinction the product depends on.
 */
export function ConfidencePanel({
  score,
  components,
  explanation,
  insufficientEvidence = false,
  className,
}: {
  score: number;
  components: Record<string, number> | null | undefined;
  explanation?: string | null;
  insufficientEvidence?: boolean;
  className?: string;
}) {
  const values = components ?? {};

  return (
    <div
      className={cn("rounded-md border border-surface-border bg-surface-sunken/40 p-3", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
          Confidence
        </span>
        {insufficientEvidence ? (
          <Badge tone="warn" title="No approved evidence supports this claim">
            insufficient evidence
          </Badge>
        ) : (
          <ConfidenceBar value={score} />
        )}
        <span className="text-2xs text-ink-subtle">
          heuristic score, not a probability that the claim is correct
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {CONFIDENCE_COMPONENT_KEYS.map((key) => (
          <ComponentRow key={key} componentKey={key} value={values[key] ?? 0} />
        ))}
      </dl>

      {explanation ? <p className="mt-2 text-xs text-ink-muted">{explanation}</p> : null}
    </div>
  );
}

function ComponentRow({
  componentKey,
  value,
}: {
  componentKey: ConfidenceComponentKey;
  value: number;
}) {
  const penalty = componentKey === "contradiction_penalty";
  return (
    <div className="min-w-0">
      <dt
        className="truncate text-2xs text-ink-subtle"
        title={`${COMPONENT_LABELS[componentKey]} — weight ${COMPONENT_WEIGHT_LABELS[componentKey]}`}
      >
        {COMPONENT_LABELS[componentKey]}
        <span className="ml-1 text-ink-subtle/70">×{COMPONENT_WEIGHT_LABELS[componentKey]}</span>
      </dt>
      <dd
        className={cn(
          "text-sm font-medium tabular-nums",
          penalty && value > 0 ? "text-danger" : "text-ink",
        )}
      >
        {penalty && value > 0 ? "−" : ""}
        {value.toFixed(2)}
      </dd>
    </div>
  );
}
