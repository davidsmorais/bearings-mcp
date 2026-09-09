import {
  type NeighbourhoodCredits,
  NeighbourhoodCreditsSchema,
  TOKEN_META_KEY,
  type TokenMeta,
  TokenMetaSchema,
} from "@bearings/shared";
import { z } from "zod";

/**
 * The three numbers this inspector exists to show. Every field except `durationMs` is
 * optional because it is genuinely absent for some calls — `echo` spends no Geoapify
 * credits, and an older server may not attach token accounting at all. Reporting `0`
 * credits for a tool that cannot spend them would be a fabricated number, not a default.
 */
export interface CallMetrics {
  readonly tokens?: TokenMeta;
  readonly credits?: NeighbourhoodCredits;
  readonly durationMs: number;
}

/** The parts of a `CallToolResult` metrics are read from. */
export interface MetricSource {
  readonly _meta?: unknown;
  readonly structuredContent?: unknown;
}

/**
 * Only tools that query Geoapify report credits, and they report them under this key
 * using the schema `packages/shared` already owns. Parsed rather than reached into:
 * a `.credits` property access would happily accept a malformed number and render it.
 */
const CreditsCarrierSchema = z.object({ credits: NeighbourhoodCreditsSchema });

/**
 * Reads the server's own token count off the response envelope. The inspector never
 * recomputes this — `gpt-tokenizer` stays out of the bundle (see DECISIONS.md,
 * 2026-09-09), and reading the server's number means the two can never disagree.
 */
export const readTokenMeta = (meta: unknown): TokenMeta | undefined => {
  if (typeof meta !== "object" || meta === null) {
    return undefined;
  }
  const result = TokenMetaSchema.safeParse((meta as Record<string, unknown>)[TOKEN_META_KEY]);
  return result.success ? result.data : undefined;
};

/** Reads Geoapify credit spend, or undefined for a tool that spends none. */
export const readCredits = (structuredContent: unknown): NeighbourhoodCredits | undefined => {
  const result = CreditsCarrierSchema.safeParse(structuredContent);
  return result.success ? result.data.credits : undefined;
};

/**
 * Never throws. A response missing `_meta` or carrying a malformed envelope yields
 * `undefined` for that metric, which the UI renders as "unavailable" — a debugging tool
 * that crashes on an unexpected response shape is useless exactly when it is needed.
 */
export const extractCallMetrics = (source: MetricSource, durationMs: number): CallMetrics => ({
  tokens: readTokenMeta(source._meta),
  credits: readCredits(source.structuredContent),
  durationMs,
});
