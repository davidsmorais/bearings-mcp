import { TOKEN_META_KEY } from "@bearings/shared";
import { describe, expect, it } from "vitest";
import { extractCallMetrics, readCredits, readTokenMeta } from "@/lib/callMetrics";

const tokenMeta = {
  approximate: true,
  tokenizer: "o200k_base",
  contentTokens: 142,
  structuredContentDuplicated: true,
  worstCaseTokens: 284,
} as const;

/** Shape captured from a live analyse_neighbourhood response, trimmed to what is read. */
const analyseResult = {
  _meta: { [TOKEN_META_KEY]: tokenMeta },
  structuredContent: {
    detail: "brief",
    credits: { consumed: 1, byDomain: { nightlife: 1, dining: 0 } },
  },
};

const echoResult = {
  _meta: { [TOKEN_META_KEY]: { ...tokenMeta, contentTokens: 5, worstCaseTokens: 10 } },
  structuredContent: { message: "hi" },
};

const toolErrorResult = {
  _meta: { [TOKEN_META_KEY]: tokenMeta },
  structuredContent: { isError: true, code: "UPSTREAM_ERROR", message: "geoapify failed" },
};

describe("readTokenMeta", () => {
  it("reads the server's count off the envelope", () => {
    expect(readTokenMeta(analyseResult._meta)).toEqual(tokenMeta);
  });

  it.each([
    ["undefined _meta", undefined],
    ["null _meta", null],
    ["a non-object _meta", "nope"],
    ["an envelope without the bearings key", { other: 1 }],
    ["a malformed envelope", { [TOKEN_META_KEY]: { contentTokens: "lots" } }],
  ])("returns undefined for %s rather than throwing", (_label, meta) => {
    expect(readTokenMeta(meta)).toBeUndefined();
  });
});

describe("readCredits", () => {
  it("reads credits from a tool that spends them", () => {
    expect(readCredits(analyseResult.structuredContent)).toEqual({
      consumed: 1,
      byDomain: { nightlife: 1, dining: 0 },
    });
  });

  it("returns undefined — not zero — for a tool that spends none", () => {
    // Zero would claim "this call cost nothing at Geoapify"; undefined says "this tool
    // does not touch Geoapify". The running total must not be fed a fabricated 0.
    expect(readCredits(echoResult.structuredContent)).toBeUndefined();
  });

  it("returns undefined for a ToolError envelope", () => {
    expect(readCredits(toolErrorResult.structuredContent)).toBeUndefined();
  });

  it("rejects a malformed credits block instead of rendering it", () => {
    expect(readCredits({ credits: { consumed: -1, byDomain: {} } })).toBeUndefined();
    expect(readCredits({ credits: { consumed: 1 } })).toBeUndefined();
  });
});

describe("extractCallMetrics", () => {
  it("carries tokens, credits and latency for a credit-spending call", () => {
    expect(extractCallMetrics(analyseResult, 380.4)).toEqual({
      tokens: tokenMeta,
      credits: { consumed: 1, byDomain: { nightlife: 1, dining: 0 } },
      durationMs: 380.4,
    });
  });

  it("carries tokens and latency, but no credits, for echo", () => {
    const metrics = extractCallMetrics(echoResult, 3);
    expect(metrics.tokens?.contentTokens).toBe(5);
    expect(metrics.credits).toBeUndefined();
    expect(metrics.durationMs).toBe(3);
  });

  it("still reports tokens and latency for a failed call", () => {
    const metrics = extractCallMetrics(toolErrorResult, 900);
    expect(metrics.tokens).toEqual(tokenMeta);
    expect(metrics.durationMs).toBe(900);
  });

  it("survives a response with neither _meta nor structuredContent", () => {
    expect(extractCallMetrics({}, 12)).toEqual({
      tokens: undefined,
      credits: undefined,
      durationMs: 12,
    });
  });
});
