// Imports the pinned `o200k_base` encoding submodule directly rather than the package
// default export, so a future major version that changes `gpt-tokenizer`'s default
// encoding cannot silently move every recorded token count out from under this file.
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

/**
 * The tokenizer encoding this estimator is pinned to. Exported as a named constant so
 * any surface that reports a token count (the MCP `_meta` envelope, the inspector's
 * cost meter) can state which tokenizer produced it.
 */
export const TOKENIZER_ENCODING = "o200k_base" as const;

/**
 * Approximates how many tokens `text` costs under the `o200k_base` GPT byte-pair
 * encoding. This is **not** Claude's tokenizer — Anthropic does not publish one — so the
 * number is an order-of-magnitude-correct approximation, not an exact cost. It is good
 * enough to compare two shapes of the same JSON payload (a `brief` response against its
 * `full` counterpart), which is the only thing this repo uses it for. Every surface that
 * displays this number must label it approximate.
 */
export function estimateTokens(text: string): number {
  return countTokens(text);
}
