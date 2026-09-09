import { ToolErrorCode } from "@bearings/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ComparePanel } from "@/components/ComparePanel";
import type { CallHistoryEntry } from "@/lib/callHistory";

afterEach(cleanup);

const makeEntry = (
  id: string,
  toolName: string,
  input: unknown,
  contentTokens?: number,
  creditsConsumed?: number,
  overrides: Partial<CallHistoryEntry> = {},
): CallHistoryEntry => ({
  id,
  toolName,
  input,
  startedAt: Date.now(),
  outcome: {
    status: "success",
    structuredContent: { result: `${id}-data` },
    content: [],
  },
  metrics: {
    durationMs: 120,
    tokens:
      contentTokens !== undefined
        ? {
            approximate: true,
            tokenizer: "o200k_base",
            contentTokens,
            structuredContentDuplicated: true,
            worstCaseTokens: contentTokens * 2,
          }
        : undefined,
    credits:
      creditsConsumed !== undefined ? { consumed: creditsConsumed, byDomain: {} } : undefined,
  },
  ...overrides,
});

describe("ComparePanel", () => {
  it("renders prompt instructions when fewer than two calls are pinned", () => {
    const { rerender } = render(<ComparePanel entries={[]} totalCredits={0} />);
    expect(screen.getByText(/Pin two calls in the history to compare them/)).toBeDefined();

    rerender(
      <ComparePanel
        entries={[makeEntry("call-1", "echo", { message: "hi" }, 10)]}
        totalCredits={0}
      />,
    );
    expect(screen.getByText(/Pin two calls in the history to compare them/)).toBeDefined();
  });

  it("calculates positive token delta, multiplier ratio, and credit comparison", () => {
    const entry1 = makeEntry("call-1", "analyse_neighbourhood", { detail: "brief" }, 100, 1);
    const entry2 = makeEntry("call-2", "analyse_neighbourhood", { detail: "full" }, 250, 2);

    render(<ComparePanel entries={[entry1, entry2]} totalCredits={3} />);

    // Delta display: 100 -> 250 (+150, x2.50)
    expect(screen.getByText(/100 → 250 tokens/)).toBeDefined();
    expect(screen.getByText(/\(\+150, ×2\.50\)/)).toBeDefined();
    // Delta increase gets colored red/magenta
    const deltaSpan = screen.getByText(/\(\+150, ×2\.50\)/);
    expect(deltaSpan.className).toContain("text-[#ff2d6a]");

    // Credits comparison: 1 -> 2 credits
    expect(screen.getByText(/1 → 2 credits/)).toBeDefined();

    // Renders both response panels with detail-annotated titles
    expect(screen.getByRole("heading", { name: "analyse_neighbourhood · brief" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "analyse_neighbourhood · full" })).toBeDefined();
  });

  it("calculates negative token delta with cyan styling when right call is smaller", () => {
    const entry1 = makeEntry("call-1", "analyse_neighbourhood", { detail: "full" }, 300, 2);
    const entry2 = makeEntry("call-2", "analyse_neighbourhood", { detail: "brief" }, 150, 1);

    render(<ComparePanel entries={[entry1, entry2]} totalCredits={3} />);

    expect(screen.getByText(/300 → 150 tokens/)).toBeDefined();
    const deltaSpan = screen.getByText(/\(-150, ×0\.50\)/);
    expect(deltaSpan.className).toContain("text-[#00ffd5]");
  });

  it("surfaces message when token accounting is absent on one of the calls", () => {
    const entryWithTokens = makeEntry("call-1", "echo", { message: "a" }, 50);
    const entryWithoutTokens = makeEntry("call-2", "echo", { message: "b" }, undefined);

    render(<ComparePanel entries={[entryWithTokens, entryWithoutTokens]} totalCredits={0} />);

    expect(
      screen.getByText(
        "Token delta unavailable — one of these responses carried no token accounting.",
      ),
    ).toBeDefined();
    // Both panels are still rendered side by side
    const headers = screen.getAllByRole("heading", { name: "echo" });
    expect(headers).toHaveLength(2);
  });

  it("handles division by zero gracefully when left token count is 0", () => {
    const zeroTokenEntry = makeEntry("call-1", "echo", {}, 0);
    const normalEntry = makeEntry("call-2", "echo", {}, 50);

    render(<ComparePanel entries={[zeroTokenEntry, normalEntry]} totalCredits={0} />);

    expect(screen.getByText(/0 → 50 tokens/)).toBeDefined();
    // Ratio falls back to '—' rather than 'Infinity' or 'NaN'
    expect(screen.getByText(/\(\+50, ×—\)/)).toBeDefined();
  });

  it("renders compare panels when one call had an error outcome", () => {
    const successEntry = makeEntry("call-1", "resolve_destination", { query: "Lisbon" }, 80);
    const errorEntry: CallHistoryEntry = {
      id: "call-2",
      toolName: "resolve_destination",
      input: { query: "" },
      startedAt: Date.now(),
      outcome: {
        status: "error",
        error: {
          isError: true,
          code: ToolErrorCode.INVALID_INPUT,
          message: "query cannot be empty",
        },
      },
      metrics: {
        durationMs: 15,
        tokens: {
          approximate: true,
          tokenizer: "o200k_base",
          contentTokens: 25,
          structuredContentDuplicated: false,
          worstCaseTokens: 25,
        },
      },
    };

    render(<ComparePanel entries={[successEntry, errorEntry]} totalCredits={0} />);

    expect(screen.getByText(/80 → 25 tokens/)).toBeDefined();
    expect(screen.getByText("INVALID_INPUT")).toBeDefined();
    expect(screen.getByText("query cannot be empty")).toBeDefined();
  });
});
