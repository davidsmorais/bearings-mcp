import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToolList } from "@/hooks/useToolList";
import { createQueryWrapper } from "@/test/queryWrapper";

const { listTools, getMcpClient } = vi.hoisted(() => {
  const listTools = vi.fn();
  return {
    listTools,
    getMcpClient: vi.fn(async () => ({ listTools })),
  };
});

vi.mock("@/lib/mcpClient", () => ({ getMcpClient }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useToolList", () => {
  it("returns the tool registry from tools/list", async () => {
    listTools.mockResolvedValue({
      tools: [{ name: "echo", description: "diagnostic", inputSchema: { type: "object" } }],
    });

    const { result } = renderHook(() => useToolList(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { name: "echo", description: "diagnostic", inputSchema: { type: "object" } },
    ]);
  });

  it("does not refetch on remount", async () => {
    listTools.mockResolvedValue({ tools: [] });

    const wrapper = createQueryWrapper();
    const first = renderHook(() => useToolList(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useToolList(), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(listTools).toHaveBeenCalledTimes(1);
  });
});
