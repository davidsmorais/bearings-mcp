import { z } from "zod";
import { isToolError, type ToolError } from "../errors.js";

/** Per-upstream health reported in a composed tool's `sources` block. */
export const SourceStatusSchema = z.enum(["ok", "partial", "unavailable"]);

export type SourceStatus = z.infer<typeof SourceStatusSchema>;

/**
 * Outcome of one upstream fetch. `note` explains a `partial` result or a clamp;
 * `error` carries the actual `ToolError` when the upstream was `unavailable` so an
 * agent can act on it (root Invariant 6: derived values carry their evidence).
 *
 * `error` is validated with the structural `isToolError` guard rather than a full
 * Zod mirror of the `ToolError` union — that union is nine variants and a parallel
 * schema would be a drift trap for a shape that is never parsed off the wire.
 */
export const SourceOutcomeSchema = z.object({
  status: SourceStatusSchema,
  note: z.string().optional(),
  error: z.custom<ToolError>((value) => isToolError(value)).optional(),
});

export type SourceOutcome = z.infer<typeof SourceOutcomeSchema>;
