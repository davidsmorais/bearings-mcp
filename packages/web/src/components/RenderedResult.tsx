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
  ok: "border border-emerald-500/30 bg-emerald-950/40 text-emerald-300",
  partial: "border border-amber-500/30 bg-amber-950/40 text-amber-300",
  unavailable: "border border-[#ff2d6a]/40 bg-[#ff2d6a]/20 text-[#ff5c8a]",
};

const FieldLabel = ({ children }: { readonly children: string }) => (
  <span className="font-mono text-xs text-[#7b8fa8]">{children}</span>
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
          <span className="font-mono text-sm text-[#e0eaf5]">{domain}</span>
          {rating ? (
            <>
              <DensityBar count={rating.count} scaleMax={scaleMax} capped={rating.countCapped} />
              <span className="font-mono text-sm tabular-nums text-[#00ffd5]">
                {rating.count}
                {rating.countCapped ? "+" : ""}{" "}
                <span className="text-[#7b8fa8]">{rating.rating}</span>
              </span>
            </>
          ) : (
            <span className="col-span-2 font-mono text-sm text-[#3d4f65]">not queried</span>
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
          STATUS_STYLES[outcome.status] ?? "border border-[#162638] bg-[#0a1829] text-[#e0eaf5]"
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
    <p className="font-mono text-sm text-[#e0eaf5]">
      {value.consumed} Geoapify {value.consumed === 1 ? "credit" : "credits"}
    </p>
    <div className="flex flex-wrap gap-2">
      {Object.entries(value.byDomain).map(([domain, credits]) => (
        <span
          key={domain}
          className="rounded border border-[#162638] bg-[#0a1829] px-2 py-0.5 font-mono text-xs text-[#7b8fa8]"
        >
          {domain}: {credits}
        </span>
      ))}
    </div>
  </div>
);

const Scalar = ({ value }: { readonly value: unknown }) => (
  <span className="font-mono text-sm text-[#e0eaf5]">
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
      return <span className="font-mono text-sm text-[#3d4f65]">empty</span>;
    }
    return (
      <ol className="space-y-2">
        {value.map((item, index) => (
          <li
            // Index keys are correct here: this list is derived from an immutable
            // response and is never reordered or spliced.
            // biome-ignore lint/suspicious/noArrayIndexKey: static, never-reordered list
            key={`${path}[${index}]`}
            className="border-[#1a2d42] border-l pl-3"
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
