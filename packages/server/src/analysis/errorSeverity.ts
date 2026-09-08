import { type ToolError, ToolErrorCode } from "@bearings/shared";

/**
 * Severity ranking used when every fan-out branch fails: the worse error is the one
 * surfaced (root Invariant 7 — the ranking is a named constant block, not magic
 * numbers). Higher is worse. Equal severity keeps the first error encountered.
 */
export const ERROR_SEVERITY: Record<ToolErrorCode, number> = {
  [ToolErrorCode.NOT_FOUND]: 1,
  [ToolErrorCode.QUOTA_EXCEEDED]: 2,
  [ToolErrorCode.RATE_LIMITED]: 3,
  [ToolErrorCode.TIMEOUT]: 4,
  [ToolErrorCode.UPSTREAM_TIMEOUT]: 4,
  [ToolErrorCode.AMBIGUOUS]: 5,
  [ToolErrorCode.INVALID_INPUT]: 5,
  [ToolErrorCode.UPSTREAM_ERROR]: 6,
  [ToolErrorCode.INTERNAL_ERROR]: 7,
};

export const moreSevereError = (first: ToolError, second: ToolError): ToolError => {
  const secondWorse = ERROR_SEVERITY[second.code] > ERROR_SEVERITY[first.code];
  const worst = secondWorse ? second : first;
  const other = secondWorse ? first : second;
  return { ...worst, isError: true, details: { ...worst.details, alsoFailed: other } };
};

/** Pick the single worst error from a non-empty list; ties keep the earliest entry. */
export const worstOfErrors = (errors: readonly ToolError[]): ToolError => {
  if (errors.length === 0) {
    throw new Error("worstOfErrors requires at least one error");
  }
  return errors.reduce((worst, current) =>
    ERROR_SEVERITY[current.code] > ERROR_SEVERITY[worst.code] ? current : worst,
  );
};
