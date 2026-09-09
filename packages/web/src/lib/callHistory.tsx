import type { ToolError } from "@bearings/shared";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import type { CallMetrics } from "@/lib/callMetrics";

/**
 * Oldest entries are dropped past this. A debugging session can easily make hundreds of
 * calls; keeping them all would grow the rendered list without bound for no benefit,
 * since comparison only ever needs two.
 */
export const MAX_HISTORY_ENTRIES = 50;

/** At most two entries compare side by side — a third pane has nowhere to go. */
export const MAX_PINNED = 2;

type CallOutcome =
  | { readonly status: "success"; readonly structuredContent: unknown; readonly content: unknown }
  | { readonly status: "error"; readonly error: ToolError };

export interface CallHistoryEntry {
  readonly id: string;
  readonly toolName: string;
  /** The parsed input actually dispatched, so a pinned pair shows what differed. */
  readonly input: unknown;
  readonly startedAt: number;
  readonly outcome: CallOutcome;
  readonly metrics: CallMetrics;
}

export type RecordedCall = Omit<CallHistoryEntry, "id">;

interface HistoryState {
  readonly entries: readonly CallHistoryEntry[];
  readonly pinnedIds: readonly string[];
  readonly nextId: number;
  /**
   * Total Geoapify credits this session has spent. Accumulated here rather than summed
   * over `entries` at render, because `entries` is capped: past 50 calls a derived sum
   * would start *decreasing* as entries age out, which is the one thing a spend counter
   * must never do. Incremented in a pure reducer from a single dispatch per call, so it
   * cannot drift the way a counter mutated in an effect would.
   */
  readonly totalCredits: number;
}

type HistoryAction =
  | { type: "record"; call: RecordedCall }
  | { type: "togglePin"; id: string }
  | { type: "clear" };

const initialState: HistoryState = { entries: [], pinnedIds: [], nextId: 1, totalCredits: 0 };

const reducer = (state: HistoryState, action: HistoryAction): HistoryState => {
  switch (action.type) {
    case "record": {
      const entry: CallHistoryEntry = { ...action.call, id: `call-${state.nextId}` };
      // Newest first: the entry a developer just produced is the one they are reading.
      const entries = [entry, ...state.entries].slice(0, MAX_HISTORY_ENTRIES);
      const surviving = new Set(entries.map((existing) => existing.id));
      return {
        entries,
        // A pin on an entry that just aged out must go with it, or the compare panel
        // would hold an id nothing resolves to.
        pinnedIds: state.pinnedIds.filter((id) => surviving.has(id)),
        nextId: state.nextId + 1,
        totalCredits: state.totalCredits + (action.call.metrics.credits?.consumed ?? 0),
      };
    }
    case "togglePin": {
      if (state.pinnedIds.includes(action.id)) {
        return { ...state, pinnedIds: state.pinnedIds.filter((id) => id !== action.id) };
      }
      // Pinning a third drops the oldest pin rather than refusing the click — the
      // developer's intent is clearly "compare this one", not "nothing happens".
      return { ...state, pinnedIds: [...state.pinnedIds, action.id].slice(-MAX_PINNED) };
    }
    case "clear":
      return { ...state, entries: [], pinnedIds: [], totalCredits: 0 };
  }
};

export interface CallHistoryValue {
  readonly entries: readonly CallHistoryEntry[];
  readonly pinnedIds: readonly string[];
  /** Pinned entries in pin order, ready for the compare panel. */
  readonly pinnedEntries: readonly CallHistoryEntry[];
  /** Running Geoapify spend for this session, including calls aged out of `entries`. */
  readonly totalCredits: number;
  readonly record: (call: RecordedCall) => void;
  readonly togglePin: (id: string) => void;
  readonly clear: () => void;
}

const CallHistoryContext = createContext<CallHistoryValue | undefined>(undefined);

export const CallHistoryProvider = ({ children }: PropsWithChildren): ReactElement => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const record = useCallback((call: RecordedCall) => dispatch({ type: "record", call }), []);
  const togglePin = useCallback((id: string) => dispatch({ type: "togglePin", id }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  const value = useMemo<CallHistoryValue>(() => {
    const byId = new Map(state.entries.map((entry) => [entry.id, entry] as const));
    return {
      entries: state.entries,
      pinnedIds: state.pinnedIds,
      pinnedEntries: state.pinnedIds
        .map((id) => byId.get(id))
        .filter((entry): entry is CallHistoryEntry => entry !== undefined),
      totalCredits: state.totalCredits,
      record,
      togglePin,
      clear,
    };
  }, [state, record, togglePin, clear]);

  return <CallHistoryContext.Provider value={value}>{children}</CallHistoryContext.Provider>;
};

export const useCallHistory = (): CallHistoryValue => {
  const value = useContext(CallHistoryContext);
  if (!value) {
    throw new Error("useCallHistory must be used within a CallHistoryProvider");
  }
  return value;
};
