import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RenderedResult } from "@/components/RenderedResult";

// Vitest runs without `globals`, so @testing-library's auto-cleanup never registers
// itself and each render would otherwise stack another copy of the DOM.
afterEach(cleanup);

const rating = (count: number, countCapped = false) => ({
  rating: count > 20 ? "high" : "low",
  count,
  radiusM: 500,
  ratingRadiusM: 500,
  densityPerKm2: count / 0.785,
  countCapped,
  rings: [{ radiusM: 250, count: Math.floor(count / 2) }],
});

describe("RenderedResult shape dispatch", () => {
  it("renders a domains block as density meters on one shared scale", () => {
    render(
      <RenderedResult
        value={{ domains: { nightlife: rating(34), transit: rating(9), retail: null } }}
      />,
    );

    const bars = document.querySelectorAll<HTMLElement>("[data-count]");
    expect(bars).toHaveLength(2);
    // One scale across siblings: the largest count is the max, not each bar's own value,
    // so 9 next to 34 renders visibly shorter rather than equally full.
    expect(bars[0]?.dataset.count).toBe("34");
    expect(bars[0]?.dataset.scaleMax).toBe("34");
    expect(bars[0]?.style.width).toBe("100%");
    expect(bars[1]?.dataset.count).toBe("9");
    expect(bars[1]?.dataset.scaleMax).toBe("34");
    expect(bars[1]?.style.width).toBe("26%");
    expect(screen.getByText("not queried")).toBeDefined();
  });

  it("marks a capped count as a floor rather than a total", () => {
    render(<RenderedResult value={{ domains: { dining: rating(20, true) } }} />);

    // The "+" is what tells a reader the count is a floor, not a total.
    expect(screen.getByText(/20\+/)).toBeDefined();
  });

  it("renders a sources block as per-upstream status chips", () => {
    render(
      <RenderedResult
        value={{ sources: { nightlife: { status: "ok" }, dining: { status: "unavailable" } } }}
      />,
    );

    expect(screen.getByText("nightlife: ok")).toBeDefined();
    expect(screen.getByText("dining: unavailable")).toBeDefined();
  });

  it("renders a credits block with its per-domain evidence", () => {
    render(
      <RenderedResult
        value={{ credits: { consumed: 2, byDomain: { nightlife: 1, dining: 1 } } }}
      />,
    );

    expect(screen.getByText("2 Geoapify credits")).toBeDefined();
    expect(screen.getByText("nightlife: 1")).toBeDefined();
  });

  it("falls back to a generic tree for a shape it has never seen", () => {
    // This is the property that keeps "adding a tool needs zero UI changes" true for
    // output: an unrecognised response degrades to readable, not to blank.
    render(<RenderedResult value={{ somethingNew: { nested: "value" }, count: 3 }} />);

    expect(screen.getByText("somethingNew")).toBeDefined();
    expect(screen.getByText("nested")).toBeDefined();
    expect(screen.getByText("value")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("renders arrays and marks an empty one rather than showing nothing", () => {
    render(<RenderedResult value={{ candidates: [], names: ["Lisbon", "Lisboa"] }} />);

    expect(screen.getByText("empty")).toBeDefined();
    expect(screen.getByText("Lisbon")).toBeDefined();
  });
});
