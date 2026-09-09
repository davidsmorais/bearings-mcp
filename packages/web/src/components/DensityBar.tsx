export interface DensityBarProps {
  /** Venue count for this domain. */
  readonly count: number;
  /** Largest count across the domains being shown, so bars share one scale. */
  readonly scaleMax: number;
  /** True when the count hit `limitPerCategory` and is therefore a floor, not a total. */
  readonly capped: boolean;
}

/**
 * A `<div>` with a width percentage. Six bars do not justify a charting dependency
 * (packages/web/AGENTS.md), and a real chart library would also drag in axes, tooltips
 * and a visual language that belongs to a product rather than a debugging tool.
 */
export const DensityBar = ({ count, scaleMax, capped }: DensityBarProps) => {
  // scaleMax of 0 means every domain returned nothing; render empty rather than NaN%.
  const percent = scaleMax > 0 ? Math.round((count / scaleMax) * 100) : 0;

  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-neutral-200">
      <div
        className={`h-full ${capped ? "bg-amber-500" : "bg-neutral-700"}`}
        style={{ width: `${percent}%` }}
        // Purely decorative: the exact count, and whether it is capped, are rendered as
        // text immediately beside the bar. Giving this a meter role would make a screen
        // reader announce the same number twice.
        aria-hidden="true"
        data-count={count}
        data-scale-max={scaleMax}
      />
    </div>
  );
};
