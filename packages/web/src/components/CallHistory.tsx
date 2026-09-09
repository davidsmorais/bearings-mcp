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
    <li className="flex items-center gap-3 border-b border-[#101f30] px-3 py-1.5 last:border-b-0 hover:bg-[#081526]/50 transition-colors">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          failed
            ? "bg-[#ff2d6a] shadow-[0_0_6px_rgba(255,45,106,0.8)]"
            : "bg-[#00ffd5] shadow-[0_0_6px_rgba(0,255,213,0.8)]"
        }`}
        role="img"
        aria-label={failed ? "failed" : "succeeded"}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#e0eaf5]">
        {entry.toolName}
        {detail ? <span className="text-[#7b8fa8]"> · {detail}</span> : null}
      </span>
      <span className="font-mono text-xs tabular-nums text-[#7b8fa8]">
        {entry.metrics.tokens ? `~${entry.metrics.tokens.contentTokens}tk` : "—"}
      </span>
      <span className="font-mono text-xs tabular-nums text-[#7b8fa8]">
        {entry.metrics.credits ? `${entry.metrics.credits.consumed}cr` : "—"}
      </span>
      <span className="font-mono text-xs tabular-nums text-[#7b8fa8]">
        {Math.round(entry.metrics.durationMs)}ms
      </span>
      <button
        type="button"
        onClick={() => onTogglePin(entry.id)}
        aria-pressed={pinned}
        className={`rounded px-2 py-0.5 font-mono text-xs transition-colors ${
          pinned
            ? "border border-[#00ffd5]/60 bg-[#00ffd5]/20 text-[#00ffd5]"
            : "border border-transparent bg-[#0a1829] text-[#7b8fa8] hover:bg-[#0e2035] hover:text-[#e0eaf5]"
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
  <section className="overflow-hidden rounded border border-[#162638] bg-[#06101e]">
    <header className="flex items-center justify-between border-b border-[#162638] bg-[#0a1829]/60 px-3 py-2">
      <h3 className="font-mono text-sm text-[#7b8fa8]">history · {entries.length}</h3>
      <button
        type="button"
        onClick={onClear}
        disabled={entries.length === 0}
        className="rounded px-2 py-0.5 font-mono text-xs text-[#7b8fa8] hover:bg-[#0e2035] hover:text-[#e0eaf5] disabled:opacity-40 transition-colors"
      >
        clear
      </button>
    </header>
    {entries.length === 0 ? (
      <p className="px-3 py-2 text-sm text-[#4a5f78]">
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
