import type { ToolError } from "@bearings/shared";
import { useState } from "react";
import { CostMeter } from "@/components/CostMeter";
import { RawJsonPane } from "@/components/RawJsonPane";
import { RenderedResult } from "@/components/RenderedResult";
import type { CallMetrics } from "@/lib/callMetrics";

export type ResponseView = "rendered" | "raw";

export interface ResponsePanelProps {
  readonly status: "idle" | "pending" | "success" | "error";
  readonly structuredContent?: unknown;
  readonly content?: unknown;
  readonly meta?: unknown;
  readonly error?: ToolError;
  readonly metrics?: CallMetrics;
  readonly totalCredits: number;
  /** Compact heading used when two panels sit side by side in the compare view. */
  readonly title?: string;
}

const ToolErrorView = ({ error }: { readonly error: ToolError }) => {
  // Rendered as the structured value it is, not as a red string — the code and any
  // recovery data (candidates on AMBIGUOUS) are what a developer needs to act on.
  const {
    isError: _isError,
    code,
    message,
    ...rest
  } = error as ToolError & {
    [key: string]: unknown;
  };

  return (
    <div className="space-y-3 rounded border border-[#ff2d6a]/40 bg-[#ff2d6a]/10 p-3">
      <p className="font-mono text-xs uppercase tracking-wide text-[#ff2d6a]">{String(code)}</p>
      <p className="text-sm text-[#ff5c8a]">{String(message)}</p>
      {Object.keys(rest).length > 0 ? <RenderedResult value={rest} /> : null}
    </div>
  );
};

export const ResponsePanel = ({
  status,
  structuredContent,
  content,
  meta,
  error,
  metrics,
  totalCredits,
  title,
}: ResponsePanelProps) => {
  const [view, setView] = useState<ResponseView>("rendered");

  return (
    <section className="overflow-hidden rounded border border-[#162638] bg-[#06101e]">
      <header className="flex items-center justify-between gap-3 border-b border-[#162638] bg-[#0a1829]/60 px-3 py-2">
        <h3 className="font-mono text-sm text-[#00ffd5]">{title ?? "response"}</h3>
        <div className="flex gap-1">
          {(["rendered", "raw"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`rounded px-2 py-1 font-mono text-xs transition-colors ${
                view === option
                  ? "border border-[#00ffd5]/60 bg-[#00ffd5]/20 text-[#00ffd5]"
                  : "border border-transparent bg-[#06101e] text-[#7b8fa8] hover:bg-[#0e2035] hover:text-[#e0eaf5]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </header>

      {metrics ? <CostMeter metrics={metrics} totalCredits={totalCredits} /> : null}

      <div className="max-h-[70vh] overflow-y-auto p-3">
        {status === "idle" ? <p className="text-sm text-[#4a5f78]">No call yet.</p> : null}

        {status === "pending" ? (
          <p className="animate-pulse font-mono text-sm text-[#00ffd5]">calling…</p>
        ) : null}

        {status === "error" && error ? (
          view === "raw" ? (
            <RawJsonPane structuredContent={error} content={content} meta={meta} />
          ) : (
            <ToolErrorView error={error} />
          )
        ) : null}

        {status === "success" ? (
          view === "raw" ? (
            <RawJsonPane structuredContent={structuredContent} content={content} meta={meta} />
          ) : (
            <RenderedResult value={structuredContent} />
          )
        ) : null}
      </div>
    </section>
  );
};
