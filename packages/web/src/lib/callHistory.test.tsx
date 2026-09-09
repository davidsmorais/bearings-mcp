import { ToolErrorCode } from "@bearings/shared";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import {
  CallHistoryProvider,
  MAX_HISTORY_ENTRIES,
  MAX_PINNED,
  type RecordedCall,
  useCallHistory,
} from "@/lib/callHistory";

const wrapper = ({ children }: PropsWithChildren) => (
  <CallHistoryProvider>{children}</CallHistoryProvider>
);

const call = (overrides: Partial<RecordedCall> = {}): RecordedCall => ({
  toolName: "analyse_neighbourhood",
  input: { detail: "brief" },
  startedAt: 0,
  outcome: { status: "success", structuredContent: {}, content: [] },
  metrics: { durationMs: 100 },
  ...overrides,
});

const withCredits = (consumed: number, overrides: Partial<RecordedCall> = {}): RecordedCall =>
  call({ metrics: { durationMs: 100, credits: { consumed, byDomain: {} } }, ...overrides });

const renderHistory = () => renderHook(() => useCallHistory(), { wrapper });

describe("useCallHistory", () => {
  it("throws outside a provider rather than silently dropping calls", () => {
    expect(() => renderHook(() => useCallHistory())).toThrow(/CallHistoryProvider/);
  });

  it("records newest first", () => {
    const { result } = renderHistory();
    act(() => result.current.record(call({ toolName: "echo" })));
    act(() => result.current.record(call({ toolName: "resolve_destination" })));

    expect(result.current.entries.map((entry) => entry.toolName)).toEqual([
      "resolve_destination",
      "echo",
    ]);
  });

  it("records failures alongside successes", () => {
    const { result } = renderHistory();
    act(() =>
      result.current.record(
        call({
          outcome: {
            status: "error",
            error: {
              isError: true,
              code: ToolErrorCode.UPSTREAM_ERROR,
              message: "geoapify failed",
            },
          },
        }),
      ),
    );

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.outcome.status).toBe("error");
  });

  it(`caps at ${MAX_HISTORY_ENTRIES} entries, dropping the oldest`, () => {
    const { result } = renderHistory();
    act(() => {
      for (let index = 0; index < MAX_HISTORY_ENTRIES + 5; index += 1) {
        result.current.record(call({ input: { index } }));
      }
    });

    expect(result.current.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(result.current.entries[0]?.input).toEqual({ index: MAX_HISTORY_ENTRIES + 4 });
  });
});

describe("running Geoapify total", () => {
  it("sums credits across calls", () => {
    const { result } = renderHistory();
    act(() => result.current.record(withCredits(1)));
    act(() => result.current.record(withCredits(2)));

    expect(result.current.totalCredits).toBe(3);
  });

  it("counts a failed call's credits — a failure can still have spent them", () => {
    const { result } = renderHistory();
    act(() =>
      result.current.record(
        withCredits(1, {
          outcome: {
            status: "error",
            error: {
              isError: true,
              code: ToolErrorCode.UPSTREAM_ERROR,
              message: "partial failure",
            },
          },
        }),
      ),
    );

    expect(result.current.totalCredits).toBe(1);
  });

  it("contributes nothing for a tool that spends no credits", () => {
    const { result } = renderHistory();
    act(() => result.current.record(call({ toolName: "echo" })));

    expect(result.current.totalCredits).toBe(0);
  });

  it("does not decrease when entries age out of the capped list", () => {
    // The whole point of this number is honesty about money spent. A total derived from
    // the surviving entries would start falling after the cap, which would be a lie.
    const { result } = renderHistory();
    act(() => {
      for (let index = 0; index < MAX_HISTORY_ENTRIES + 10; index += 1) {
        result.current.record(withCredits(1));
      }
    });

    expect(result.current.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(result.current.totalCredits).toBe(MAX_HISTORY_ENTRIES + 10);
  });

  it("resets on clear", () => {
    const { result } = renderHistory();
    act(() => result.current.record(withCredits(2)));
    act(() => result.current.clear());

    expect(result.current.entries).toHaveLength(0);
    expect(result.current.totalCredits).toBe(0);
  });
});

describe("pinning", () => {
  it("pins and unpins by id", () => {
    const { result } = renderHistory();
    act(() => result.current.record(call()));
    const id = result.current.entries[0]?.id as string;

    act(() => result.current.togglePin(id));
    expect(result.current.pinnedEntries.map((entry) => entry.id)).toEqual([id]);

    act(() => result.current.togglePin(id));
    expect(result.current.pinnedEntries).toHaveLength(0);
  });

  it(`keeps at most ${MAX_PINNED}, dropping the oldest pin`, () => {
    const { result } = renderHistory();
    act(() => {
      result.current.record(call({ input: { n: 1 } }));
      result.current.record(call({ input: { n: 2 } }));
      result.current.record(call({ input: { n: 3 } }));
    });
    const ids = result.current.entries.map((entry) => entry.id);

    act(() => {
      for (const id of ids) {
        result.current.togglePin(id);
      }
    });

    expect(result.current.pinnedIds).toEqual([ids[1], ids[2]]);
  });

  it("drops a pin whose entry aged out, so compare never holds a dangling id", () => {
    const { result } = renderHistory();
    act(() => result.current.record(call({ input: { first: true } })));
    const firstId = result.current.entries[0]?.id as string;
    act(() => result.current.togglePin(firstId));

    act(() => {
      for (let index = 0; index < MAX_HISTORY_ENTRIES; index += 1) {
        result.current.record(call());
      }
    });

    expect(result.current.pinnedIds).not.toContain(firstId);
    expect(result.current.pinnedEntries).toHaveLength(0);
  });
});
