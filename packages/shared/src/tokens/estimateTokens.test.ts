import { describe, expect, it } from "vitest";
import { estimateTokens } from "./estimateTokens.js";

describe("estimateTokens", () => {
  it("returns 0 for an empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("matches a pinned count for a known short ASCII string", () => {
    // Pinned against `o200k_base`; a tokenizer upgrade that moves this needs to be
    // a deliberate, visible change to this test, not a silent drift.
    expect(estimateTokens("Hello, world!")).toBe(4);
  });

  it("costs more than a naive length/4 guess for multi-byte unicode text", () => {
    const text = "你好世界你好世界你好世界你好世界";
    const naiveGuess = text.length / 4;
    expect(estimateTokens(text)).toBeGreaterThan(naiveGuess);
  });

  it("never decreases when text is appended", () => {
    const base = "The quick brown fox";
    const extended = `${base} jumps over the lazy dog`;
    expect(estimateTokens(extended)).toBeGreaterThanOrEqual(estimateTokens(base));
  });

  it("is stable across repeated calls on the same input", () => {
    const text = "Repeated input should always cost the same number of tokens.";
    const first = estimateTokens(text);
    const second = estimateTokens(text);
    expect(first).toBe(second);
  });
});
