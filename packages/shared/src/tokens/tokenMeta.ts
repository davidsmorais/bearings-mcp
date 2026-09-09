import { z } from "zod";

/**
 * `_meta` key the approximate per-response token count rides on. Declared here rather
 * than in `packages/server` so the server that writes the envelope and the inspector
 * that reads it agree by construction — a hand-copied key in `packages/web` would make
 * the count silently vanish the day either side changed it (root Invariant 2).
 */
export const TOKEN_META_KEY = "bearings/tokens" as const;

/**
 * Shape of the token accounting attached to every MCP response, success or error.
 *
 * `tokenizer` is a plain string rather than a literal pinned to `TOKENIZER_ENCODING`
 * on purpose: importing `estimateTokens.js` here would drag `gpt-tokenizer`'s megabytes
 * of rank data into the main barrel, and therefore into the inspector's bundle — the
 * exact thing the `@bearings/shared/tokens` subpath export exists to prevent. This
 * module must stay dependency-free beyond zod.
 *
 * Unknown keys are stripped rather than rejected, so a server that starts reporting a
 * new field does not break an inspector built against the older shape.
 */
export const TokenMetaSchema = z.object({
  /** Always true. The count is a GPT-encoding approximation, never Claude's tokenizer. */
  approximate: z.literal(true),
  /** Encoding that produced the count, e.g. `o200k_base`. Displayed alongside it. */
  tokenizer: z.string().min(1),
  /** Tokens in `content[0].text`. */
  contentTokens: z.number().int().min(0),
  /** Whether `structuredContent` carries the identical JSON a second time. */
  structuredContentDuplicated: z.boolean(),
  /** `contentTokens * 2` when duplicated — the honest cost if a host forwards both. */
  worstCaseTokens: z.number().int().min(0),
});

export type TokenMeta = z.infer<typeof TokenMetaSchema>;
