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
    <div className="space-y-3 rounded border border-red-300 bg-red-50 p-3">
      <p className="font-mono text-red-900 text-xs uppercase tracking-wide">{String(code)}</p>
      <p className="text-red-900 text-sm">{String(message)}</p>
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
    <section className="rounded border border-neutral-200 bg-white">
      <header className="flex items-center justify-between gap-3 border-neutral-200 border-b px-3 py-2">
        <h3 className="font-mono text-neutral-700 text-sm">{title ?? "response"}</h3>
        <div className="flex gap-1">
          {(["rendered", "raw"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`rounded px-2 py-1 font-mono text-xs ${
                view === option
                  ? "bg-neutral-800 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </header>

      {metrics ? <CostMeter metrics={metrics} totalCredits={totalCredits} /> : null}

      <div className="p-3">
        {status === "idle" ? <p className="text-neutral-500 text-sm">No call yet.</p> : null}

        {status === "pending" ? (
          <p className="font-mono text-neutral-500 text-sm">calling…</p>
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
