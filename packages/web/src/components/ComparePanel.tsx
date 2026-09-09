import { ResponsePanel } from "@/components/ResponsePanel";
import type { CallHistoryEntry } from "@/lib/callHistory";

export interface ComparePanelProps {
  readonly entries: readonly CallHistoryEntry[];
  readonly totalCredits: number;
}

const labelFor = (entry: CallHistoryEntry): string => {
  const detail = (entry.input as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" ? `${entry.toolName} · ${detail}` : entry.toolName;
};

const Delta = ({ entries }: { readonly entries: readonly CallHistoryEntry[] }) => {
  const [left, right] = entries;
  const leftTokens = left?.metrics.tokens?.contentTokens;
  const rightTokens = right?.metrics.tokens?.contentTokens;

  if (leftTokens === undefined || rightTokens === undefined) {
    return (
      <p className="text-neutral-500 text-sm">
        Token delta unavailable — one of these responses carried no token accounting.
      </p>
    );
  }

  const delta = rightTokens - leftTokens;
  const ratio = leftTokens > 0 ? (rightTokens / leftTokens).toFixed(2) : "—";

  return (
    <p className="font-mono text-neutral-800 text-sm tabular-nums">
      {leftTokens} → {rightTokens} tokens{" "}
      <span className={delta > 0 ? "text-amber-700" : "text-emerald-700"}>
        ({delta >= 0 ? "+" : ""}
        {delta}, ×{ratio})
      </span>
      <span className="ml-3 text-neutral-500">
        {left?.metrics.credits?.consumed ?? 0} → {right?.metrics.credits?.consumed ?? 0} credits
      </span>
    </p>
  );
};

/**
 * Two pinned calls side by side. Both panes are the same `ResponsePanel` the single-call
 * view uses — a third rendering path would be one more place for the two views to
 * disagree about what a response looks like.
 */
export const ComparePanel = ({ entries, totalCredits }: ComparePanelProps) => {
  if (entries.length < 2) {
    return (
      <section className="rounded border border-neutral-200 border-dashed bg-white px-3 py-2">
        <p className="text-neutral-500 text-sm">
          Pin two calls in the history to compare them — brief against full, or any two inputs, with
          the token delta between them.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
        <Delta entries={entries} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {entries.map((entry) => (
          <ResponsePanel
            key={entry.id}
            title={labelFor(entry)}
            status={entry.outcome.status}
            structuredContent={
              entry.outcome.status === "success" ? entry.outcome.structuredContent : undefined
            }
            content={entry.outcome.status === "success" ? entry.outcome.content : undefined}
            error={entry.outcome.status === "error" ? entry.outcome.error : undefined}
            metrics={entry.metrics}
            totalCredits={totalCredits}
          />
        ))}
      </div>
    </section>
  );
};
