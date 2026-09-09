import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFaultInjection } from "@/hooks/useFaultInjection";
import { createQueryWrapper } from "@/test/queryWrapper";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("useFaultInjection", () => {
  it("reports unavailable when the server has no fault route", async () => {
    // The normal case: a server started without BEARINGS_FAULT_INJECTION. The UI hides
    // the control rather than showing one that cannot work.
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const { result } = renderHook(() => useFaultInjection(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.available).toBe(false);
    expect(result.current.faults).toEqual({});
  });

  it("reports the armed faults when the route exists", async () => {
    fetchMock.mockResolvedValue(json({ faults: { geoapify: "timeout" } }));

    const { result } = renderHook(() => useFaultInjection(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.faults).toEqual({ geoapify: "timeout" });
  });

  it("posts a new map and adopts the server's echo of it", async () => {
    fetchMock.mockResolvedValueOnce(json({ faults: {} }));
    const { result } = renderHook(() => useFaultInjection(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.available).toBe(true));

    fetchMock.mockResolvedValueOnce(json({ faults: { nager: "rate_limited" } }));
    result.current.setFaults.mutate({ nager: "rate_limited" });

    await waitFor(() => expect(result.current.faults).toEqual({ nager: "rate_limited" }));

    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(String(url)).toContain("/__dev/faults");
    expect((init as RequestInit)?.method).toBe("POST");
  });

  it("surfaces a rejected map as an error rather than pretending it applied", async () => {
    fetchMock.mockResolvedValueOnce(json({ faults: {} }));
    const { result } = renderHook(() => useFaultInjection(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.available).toBe(true));

    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }));
    result.current.setFaults.mutate({ nager: "rate_limited" });

    await waitFor(() => expect(result.current.setFaults.isError).toBe(true));
    expect(result.current.faults).toEqual({});
  });
});
