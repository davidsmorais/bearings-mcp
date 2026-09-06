import { useQueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCallError, useToolCall } from "@/hooks/useToolCall";
import { queryClient } from "@/lib/queryClient";
import { toolKeys } from "@/lib/queryKeys";
import { createQueryWrapper } from "@/test/queryWrapper";

const { callTool, getMcpClient } = vi.hoisted(() => {
  const callTool = vi.fn();
  return {
    callTool,
    getMcpClient: vi.fn(async () => ({ callTool })),
  };
});

vi.mock("@/lib/mcpClient", () => ({ getMcpClient }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useToolCall", () => {
  it("returns structured content and a measured duration on success", async () => {
    callTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: '{"message":"hi"}' }],
      structuredContent: { message: "hi" },
    });

    const { result } = renderHook(() => useToolCall(), { wrapper: createQueryWrapper() });
    result.current.mutate({ name: "echo", input: { message: "hi" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(callTool).toHaveBeenCalledWith({ name: "echo", arguments: { message: "hi" } });
    expect(result.current.data?.structuredContent).toEqual({ message: "hi" });
    expect(typeof result.current.data?.durationMs).toBe("number");
  });

  it("unwraps an isError response into a typed ToolError", async () => {
    callTool.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "nominatim upstream error (500)" }],
      structuredContent: {
        isError: true,
        code: "UPSTREAM_ERROR",
        message: "nominatim upstream error (500)",
      },
    });

    const { result } = renderHook(() => useToolCall(), { wrapper: createQueryWrapper() });
    result.current.mutate({ name: "echo", input: { message: "hi" } });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const error = result.current.error;
    expect(error).toBeInstanceOf(ToolCallError);
    expect(error?.toolError).toEqual({
      isError: true,
      code: "UPSTREAM_ERROR",
      message: "nominatim upstream error (500)",
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid input client-side before any dispatch", async () => {
    const { result } = renderHook(() => useToolCall(), { wrapper: createQueryWrapper() });
    result.current.mutate({ name: "echo", input: { message: "" } });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(getMcpClient).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
    expect(result.current.error).toBeInstanceOf(ToolCallError);
    expect(result.current.error?.toolError.code).toBe("INVALID_INPUT");
  });

  it("does not retry a failing call (retry: false → exactly one request)", async () => {
    callTool.mockRejectedValue(new Error("transport down"));

    const { result } = renderHook(() => useToolCall(), { wrapper: createQueryWrapper() });
    result.current.mutate({ name: "echo", input: { message: "hi" } });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("pins retry: false on the production QueryClient", () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("caches the successful result under toolKeys.call", async () => {
    callTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: "{}" }],
      structuredContent: { message: "hi" },
    });

    const { result } = renderHook(() => ({ call: useToolCall(), client: useQueryClient() }), {
      wrapper: createQueryWrapper(),
    });
    result.current.call.mutate({ name: "echo", input: { message: "hi" } });

    await waitFor(() => expect(result.current.call.isSuccess).toBe(true));

    const cached = result.current.client.getQueryData(toolKeys.call("echo", { message: "hi" }));
    expect(cached).toMatchObject({ structuredContent: { message: "hi" } });
  });
});
