import { ToolErrorCode } from "@bearings/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResponsePanel } from "@/components/ResponsePanel";
import type { CallMetrics } from "@/lib/callMetrics";

afterEach(cleanup);

const sampleMetrics: CallMetrics = {
  durationMs: 85,
  tokens: {
    approximate: true,
    tokenizer: "o200k_base",
    contentTokens: 42,
    structuredContentDuplicated: true,
    worstCaseTokens: 84,
  },
};

describe("ResponsePanel", () => {
  it("renders idle state with default title and placeholder", () => {
    render(<ResponsePanel status="idle" totalCredits={0} />);

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("response");
    expect(screen.getByText("No call yet.")).toBeDefined();
  });

  it("renders custom title when provided", () => {
    render(<ResponsePanel status="idle" totalCredits={0} title="analyse_neighbourhood · brief" />);

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "analyse_neighbourhood · brief",
    );
  });

  it("renders calling indicator in pending state", () => {
    render(<ResponsePanel status="pending" totalCredits={0} />);

    expect(screen.getByText("calling…")).toBeDefined();
  });

  it("renders success result and toggles between rendered and raw views", () => {
    render(
      <ResponsePanel
        status="success"
        structuredContent={{ destination: "Porto", days: 3 }}
        totalCredits={0}
      />,
    );

    // Default is rendered view
    expect(screen.getByText("destination")).toBeDefined();
    expect(screen.getByText("Porto")).toBeDefined();

    // Toggle to raw view
    const rawButton = screen.getByRole("button", { name: "raw" });
    fireEvent.click(rawButton);

    // Raw JSON pane shows section headers
    expect(screen.getByText("structuredContent")).toBeDefined();

    // Toggle back to rendered view
    const renderedButton = screen.getByRole("button", { name: "rendered" });
    fireEvent.click(renderedButton);

    expect(screen.getByText("Porto")).toBeDefined();
  });

  it("renders ToolErrorView in error state with code, message, and recovery data", () => {
    const error = {
      isError: true as const,
      code: ToolErrorCode.INVALID_INPUT,
      message: "radius must be 5000m or less, received 50000",
      radiusM: 50000,
    };

    render(<ResponsePanel status="error" error={error} totalCredits={0} />);

    expect(screen.getByText("INVALID_INPUT")).toBeDefined();
    expect(screen.getByText("radius must be 5000m or less, received 50000")).toBeDefined();
    // Additional structured details passed to RenderedResult
    expect(screen.getByText("radiusM")).toBeDefined();
    expect(screen.getByText("50000")).toBeDefined();
  });

  it("switches to raw view for error state", () => {
    const error = {
      isError: true as const,
      code: ToolErrorCode.UPSTREAM_ERROR,
      message: "upstream timeout",
    };

    render(<ResponsePanel status="error" error={error} totalCredits={0} />);

    fireEvent.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByText("structuredContent")).toBeDefined();
  });

  it("renders CostMeter when metrics are provided and omits it when undefined", () => {
    const { rerender } = render(
      <ResponsePanel
        status="success"
        structuredContent={{ ok: true }}
        totalCredits={2}
        metrics={sampleMetrics}
      />,
    );

    expect(screen.getByText("~42")).toBeDefined();
    expect(screen.getByText("85ms")).toBeDefined();

    rerender(
      <ResponsePanel
        status="success"
        structuredContent={{ ok: true }}
        totalCredits={2}
        metrics={undefined}
      />,
    );

    expect(screen.queryByText("~42")).toBeNull();
    expect(screen.queryByText("85ms")).toBeNull();
  });
});
