import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { createQueryWrapper } from "@/test/queryWrapper";

const { listTools, getMcpClient } = vi.hoisted(() => {
  const listTools = vi.fn();
  return {
    listTools,
    getMcpClient: vi.fn(async () => ({ listTools })),
  };
});

vi.mock("@/lib/mcpClient", () => ({
  getMcpClient,
  getMcpUrl: () => "http://localhost:3000/mcp",
}));

afterEach(cleanup);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Bearings logo in the header", () => {
    listTools.mockResolvedValue({ tools: [] });
    render(<App />, { wrapper: createQueryWrapper() });

    const logo = screen.getByRole("img", { name: "Bearings MCP" });
    expect(logo).toBeDefined();
    expect(logo.getAttribute("src")).toContain("logo");
  });
});
