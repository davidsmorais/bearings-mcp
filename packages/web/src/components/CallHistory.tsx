import type { CallHistoryEntry } from "@/lib/callHistory";

export interface CallHistoryProps {
  readonly entries: readonly CallHistoryEntry[];
  readonly pinnedIds: readonly string[];
  readonly onTogglePin: (id: string) => void;
  readonly onClear: () => void;
}

const detailOf = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const detail = (input as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail : undefined;
};

const Row = ({
  entry,
  pinned,
  onTogglePin,
}: {
  readonly entry: CallHistoryEntry;
  readonly pinned: boolean;
  readonly onTogglePin: (id: string) => void;
}) => {
  const detail = detailOf(entry.input);
  const failed = entry.outcome.status === "error";

  return (
    <li className="flex items-center gap-3 border-neutral-100 border-b px-3 py-1.5 last:border-b-0">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${failed ? "bg-red-500" : "bg-emerald-500"}`}
        role="img"
        aria-label={failed ? "failed" : "succeeded"}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-neutral-800 text-xs">
        {entry.toolName}
        {detail ? <span className="text-neutral-500"> · {detail}</span> : null}
      </span>
      <span className="font-mono text-neutral-600 text-xs tabular-nums">
        {entry.metrics.tokens ? `~${entry.metrics.tokens.contentTokens}tk` : "—"}
      </span>
      <span className="font-mono text-neutral-600 text-xs tabular-nums">
        {entry.metrics.credits ? `${entry.metrics.credits.consumed}cr` : "—"}
      </span>
      <span className="font-mono text-neutral-600 text-xs tabular-nums">
        {Math.round(entry.metrics.durationMs)}ms
      </span>
      <button
        type="button"
        onClick={() => onTogglePin(entry.id)}
        aria-pressed={pinned}
        className={`rounded px-2 py-0.5 font-mono text-xs ${
          pinned ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-700"
        }`}
      >
        {pinned ? "pinned" : "pin"}
      </button>
    </li>
  );
};

/**
 * Every call this session made, newest first, with the three numbers that matter.
 * Pinning two rows is how brief and full get compared — the comparison reuses calls
 * already paid for rather than firing a fresh pair and doubling Geoapify spend.
 */
export const CallHistory = ({ entries, pinnedIds, onTogglePin, onClear }: CallHistoryProps) => (
  <section className="rounded border border-neutral-200 bg-white">
    <header className="flex items-center justify-between border-neutral-200 border-b px-3 py-2">
      <h3 className="font-mono text-neutral-700 text-sm">history · {entries.length}</h3>
      <button
        type="button"
        onClick={onClear}
        disabled={entries.length === 0}
        className="rounded px-2 py-0.5 font-mono text-neutral-600 text-xs hover:bg-neutral-100 disabled:opacity-40"
      >
        clear
      </button>
    </header>
    {entries.length === 0 ? (
      <p className="px-3 py-2 text-neutral-500 text-sm">
        Calls appear here with their token count, credit spend and latency. Pin two to compare them.
      </p>
    ) : (
      <ol>
        {entries.map((entry) => (
          <Row
            key={entry.id}
            entry={entry}
            pinned={pinnedIds.includes(entry.id)}
            onTogglePin={onTogglePin}
          />
        ))}
      </ol>
    )}
  </section>
);
