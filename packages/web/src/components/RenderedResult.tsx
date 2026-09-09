import {
  DomainRatingSchema,
  NeighbourhoodCreditsSchema,
  SourceOutcomeSchema,
} from "@bearings/shared";
import type { ReactElement } from "react";
import { z } from "zod";
import { DensityBar } from "@/components/DensityBar";

/**
 * Recognisers are keyed on **shape**, matched with the very schemas `packages/shared`
 * already owns — never on tool name. That is what keeps "adding a tool needs zero UI
 * changes" true for output as well as input: a new tool whose response contains a
 * `domains` block gets density bars for free, and one that contains nothing recognisable
 * degrades to the generic tree rather than to a blank pane. A file named after a tool in
 * this directory is the signal that this approach has been abandoned.
 */

/** A `domains` block: every value is a DomainRating (or null for an unqueried domain). */
const DomainMapSchema = z
  .record(z.string(), DomainRatingSchema.nullable())
  .refine((value) => Object.keys(value).length > 0);

/** A `sources` block: every value is a per-upstream outcome. */
const SourceMapSchema = z
  .record(z.string(), SourceOutcomeSchema)
  .refine((value) => Object.keys(value).length > 0);

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-900",
  partial: "bg-amber-100 text-amber-900",
  unavailable: "bg-red-100 text-red-900",
};

const FieldLabel = ({ children }: { readonly children: string }) => (
  <span className="font-mono text-xs text-neutral-500">{children}</span>
);

const DomainMap = ({ value }: { readonly value: z.infer<typeof DomainMapSchema> }) => {
  const entries = Object.entries(value);
  // One shared scale across siblings — per-bar scaling would make a 3-venue domain and a
  // 34-venue domain look identical, which is the opposite of what this view is for.
  const scaleMax = Math.max(0, ...entries.map(([, rating]) => rating?.count ?? 0));

  return (
    <div className="space-y-2">
      {entries.map(([domain, rating]) => (
        <div key={domain} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3">
          <span className="font-mono text-sm text-neutral-800">{domain}</span>
          {rating ? (
            <>
              <DensityBar count={rating.count} scaleMax={scaleMax} capped={rating.countCapped} />
              <span className="font-mono text-sm tabular-nums text-neutral-800">
                {rating.count}
                {rating.countCapped ? "+" : ""}{" "}
                <span className="text-neutral-500">{rating.rating}</span>
              </span>
            </>
          ) : (
            <span className="col-span-2 font-mono text-sm text-neutral-400">not queried</span>
          )}
        </div>
      ))}
    </div>
  );
};

const SourceMap = ({ value }: { readonly value: z.infer<typeof SourceMapSchema> }) => (
  <div className="flex flex-wrap gap-2">
    {Object.entries(value).map(([source, outcome]) => (
      <span
        key={source}
        className={`rounded px-2 py-0.5 font-mono text-xs ${
          STATUS_STYLES[outcome.status] ?? "bg-neutral-100 text-neutral-800"
        }`}
        title={outcome.note ?? outcome.error?.message}
      >
        {source}: {outcome.status}
      </span>
    ))}
  </div>
);

const Credits = ({ value }: { readonly value: z.infer<typeof NeighbourhoodCreditsSchema> }) => (
  <div className="space-y-1">
    <p className="font-mono text-sm text-neutral-800">
      {value.consumed} Geoapify {value.consumed === 1 ? "credit" : "credits"}
    </p>
    <div className="flex flex-wrap gap-2">
      {Object.entries(value.byDomain).map(([domain, credits]) => (
        <span key={domain} className="font-mono text-xs text-neutral-500">
          {domain}: {credits}
        </span>
      ))}
    </div>
  </div>
);

const Scalar = ({ value }: { readonly value: unknown }) => (
  <span className="font-mono text-sm text-neutral-800">
    {value === null ? "null" : String(value)}
  </span>
);

/** Ordered: the first recogniser that matches wins, generic tree last. */
const renderValue = (value: unknown, path: string): ReactElement => {
  if (typeof value !== "object" || value === null) {
    return <Scalar value={value} />;
  }

  const credits = NeighbourhoodCreditsSchema.safeParse(value);
  if (credits.success) {
    return <Credits value={credits.data} />;
  }

  const domains = DomainMapSchema.safeParse(value);
  if (domains.success) {
    return <DomainMap value={domains.data} />;
  }

  const sources = SourceMapSchema.safeParse(value);
  if (sources.success) {
    return <SourceMap value={sources.data} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="font-mono text-sm text-neutral-400">empty</span>;
    }
    return (
      <ol className="space-y-2">
        {value.map((item, index) => (
          <li
            // Index keys are correct here: this list is derived from an immutable
            // response and is never reordered or spliced.
            // biome-ignore lint/suspicious/noArrayIndexKey: static, never-reordered list
            key={`${path}[${index}]`}
            className="border-neutral-200 border-l pl-3"
          >
            {renderValue(item, `${path}[${index}]`)}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <dl className="space-y-2">
      {Object.entries(value).map(([key, nested]) => (
        <div key={`${path}.${key}`} className="grid grid-cols-[10rem_1fr] items-start gap-3">
          <dt>
            <FieldLabel>{key}</FieldLabel>
          </dt>
          <dd>{renderValue(nested, `${path}.${key}`)}</dd>
        </div>
      ))}
    </dl>
  );
};

export interface RenderedResultProps {
  readonly value: unknown;
}

export const RenderedResult = ({ value }: RenderedResultProps) => (
  <div className="text-sm">{renderValue(value, "$")}</div>
);
