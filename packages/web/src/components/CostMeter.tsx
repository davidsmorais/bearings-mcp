import type { CallMetrics } from "@/lib/callMetrics";

export interface CostMeterProps {
  readonly metrics: CallMetrics;
  /** Session-wide Geoapify spend, shown alongside this call's own. */
  readonly totalCredits: number;
}

const Metric = ({
  label,
  value,
  title,
}: {
  readonly label: string;
  readonly value: string;
  readonly title?: string;
}) => (
  <div className="flex items-baseline gap-1.5" title={title}>
    <span className="font-mono text-xs uppercase tracking-wide text-neutral-500">{label}</span>
    <span className="font-mono text-sm tabular-nums text-neutral-900">{value}</span>
  </div>
);

/**
 * Tokens, credits and latency, always visible next to the result and never behind a
 * details toggle (packages/web/AGENTS.md). The token figure is labelled approximate and
 * names its tokenizer, because it is a GPT byte-pair encoding and not Claude's — a number
 * good for comparing two shapes of the same payload, not for predicting a bill.
 */
export const CostMeter = ({ metrics, totalCredits }: CostMeterProps) => {
  const { tokens, credits, durationMs } = metrics;

  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-neutral-200 border-y bg-neutral-50 px-3 py-2">
      <Metric
        label="tokens"
        value={tokens ? `~${tokens.contentTokens}` : "—"}
        title={
          tokens
            ? `Approximate, ${tokens.tokenizer}. Worst case ${tokens.worstCaseTokens} if the host forwards both content and structuredContent.`
            : "No token accounting on this response"
        }
      />
      <Metric
        label="worst case"
        value={tokens ? `~${tokens.worstCaseTokens}` : "—"}
        title="content + structuredContent, which carry identical JSON"
      />
      <Metric
        label="credits"
        // Undefined means this tool does not touch Geoapify; "0" would claim a free
        // Geoapify call happened, which is a different and untrue statement.
        value={credits ? String(credits.consumed) : "n/a"}
        title={credits ? "Geoapify credits this call consumed" : "This tool spends no credits"}
      />
      <Metric
        label="session"
        value={`${totalCredits} cr`}
        title="Running Geoapify spend since this page loaded"
      />
      <Metric label="latency" value={`${Math.round(durationMs)}ms`} />
      {tokens ? (
        <span className="text-neutral-400 text-xs">approximate · {tokens.tokenizer}</span>
      ) : null}
    </div>
  );
};
