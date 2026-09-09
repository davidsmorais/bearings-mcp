import { describe, expect, it } from "vitest";
import { TOKEN_META_KEY, TokenMetaSchema } from "./tokenMeta.js";

const valid = {
  approximate: true,
  tokenizer: "o200k_base",
  contentTokens: 142,
  structuredContentDuplicated: true,
  worstCaseTokens: 284,
} as const;

describe("TOKEN_META_KEY", () => {
  it("is the key the server writes and the inspector reads", () => {
    expect(TOKEN_META_KEY).toBe("bearings/tokens");
  });
});

describe("TokenMetaSchema", () => {
  it("parses a complete envelope", () => {
    expect(TokenMetaSchema.parse(valid)).toEqual(valid);
  });

  it("strips unknown keys instead of rejecting them", () => {
    // Forward compatibility: an inspector built against this shape must keep working
    // against a server that started reporting an extra field.
    const result = TokenMetaSchema.safeParse({ ...valid, cacheHit: true });
    expect(result.success).toBe(true);
    expect(result.success && "cacheHit" in result.data).toBe(false);
  });

  it.each([
    "tokenizer",
    "contentTokens",
    "structuredContentDuplicated",
    "worstCaseTokens",
    "approximate",
  ] as const)("rejects an envelope missing %s", (field) => {
    const { [field]: _dropped, ...partial } = valid;
    expect(TokenMetaSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects approximate: false — the count is never exact", () => {
    expect(TokenMetaSchema.safeParse({ ...valid, approximate: false }).success).toBe(false);
  });

  it("rejects a fractional or negative token count", () => {
    expect(TokenMetaSchema.safeParse({ ...valid, contentTokens: 1.5 }).success).toBe(false);
    expect(TokenMetaSchema.safeParse({ ...valid, worstCaseTokens: -1 }).success).toBe(false);
  });

  it("rejects an empty tokenizer name", () => {
    expect(TokenMetaSchema.safeParse({ ...valid, tokenizer: "" }).success).toBe(false);
  });
});
