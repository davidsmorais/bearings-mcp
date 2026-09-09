import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CostMeter } from "@/components/CostMeter";
import type { CallMetrics } from "@/lib/callMetrics";

afterEach(cleanup);

const createMetrics = (overrides: Partial<CallMetrics> = {}): CallMetrics => ({
  durationMs: 142.4,
  tokens: {
    approximate: true,
    tokenizer: "o200k_base",
    contentTokens: 120,
    structuredContentDuplicated: true,
    worstCaseTokens: 240,
  },
  credits: {
    consumed: 2,
    byDomain: { nightlife: 1, dining: 1 },
  },
  ...overrides,
});

describe("CostMeter", () => {
  it("renders tokens, worst case, credits, session total, and latency when all metrics exist", () => {
    render(<CostMeter metrics={createMetrics()} totalCredits={5} />);

    expect(screen.getByText("~120")).toBeDefined();
    expect(screen.getByText("~240")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("5 cr")).toBeDefined();
    expect(screen.getByText("142ms")).toBeDefined();
    expect(screen.getByText("approximate · o200k_base")).toBeDefined();
  });

  it("renders dashes when token accounting is missing and omits the tokenizer note", () => {
    render(<CostMeter metrics={createMetrics({ tokens: undefined })} totalCredits={0} />);

    // Tokens and worst-case are both dashes when token accounting is absent.
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/approximate ·/)).toBeNull();
  });

  it("renders 'n/a' for credits when tool spends no credits", () => {
    // Undefined credits means the tool cannot touch Geoapify (e.g. echo or resolve_destination).
    // It must render 'n/a', not '0', which would falsely claim a free Geoapify query happened.
    render(<CostMeter metrics={createMetrics({ credits: undefined })} totalCredits={3} />);

    expect(screen.getByText("n/a")).toBeDefined();
  });

  it("renders '0' for credits when Geoapify was queried with zero consumption", () => {
    render(
      <CostMeter
        metrics={createMetrics({ credits: { consumed: 0, byDomain: {} } })}
        totalCredits={4}
      />,
    );

    expect(screen.getByText("0")).toBeDefined();
  });

  it("rounds latency to the nearest integer millisecond", () => {
    render(<CostMeter metrics={createMetrics({ durationMs: 45.8 })} totalCredits={0} />);

    expect(screen.getByText("46ms")).toBeDefined();
  });
});
