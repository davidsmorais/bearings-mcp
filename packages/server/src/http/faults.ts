import type { HostId } from "./types.js";

/**
 * Upstream conditions the inspector can ask the server to simulate, so the
 * partial-result path (`sources: { nightlife: "unavailable" }`) is demonstrable without
 * unplugging the network or waiting for Geoapify to actually fail.
 */
export type FaultKind = "timeout" | "rate_limited" | "quota_exceeded" | "upstream_error";

const FAULT_KINDS: readonly FaultKind[] = [
  "timeout",
  "rate_limited",
  "quota_exceeded",
  "upstream_error",
];

const HOST_IDS: readonly HostId[] = ["nominatim", "open-meteo", "nager", "geoapify"];

export type FaultMap = Partial<Record<HostId, FaultKind>>;

/**
 * Module-level, and therefore shared by every session on this process. That is a
 * deliberate simplification: this is a loopback development tool, and per-session fault
 * state would mean threading the transport's session map down into the HTTP core for a
 * feature that exists to make a demo reproducible. Two inspector tabs share one setting.
 */
let faults: FaultMap = {};

export const setFaults = (next: FaultMap): void => {
  faults = { ...next };
};

export const getFaults = (): FaultMap => ({ ...faults });

export const clearFaults = (): void => {
  faults = {};
};

/** The fault armed for `hostId`, or undefined when that upstream should behave normally. */
export const faultFor = (hostId: HostId): FaultKind | undefined => faults[hostId];

/**
 * Validates a fault map arriving over the wire. Returns undefined for anything that is
 * not a `{ hostId: faultKind }` object, so the control route rejects rather than storing
 * a shape the core would silently ignore. A `null` value clears that host's fault.
 */
export const parseFaultMap = (value: unknown): FaultMap | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const parsed: FaultMap = {};
  for (const [host, kind] of Object.entries(value)) {
    if (!HOST_IDS.includes(host as HostId)) {
      return undefined;
    }
    if (kind === null || kind === undefined) {
      continue;
    }
    if (typeof kind !== "string" || !FAULT_KINDS.includes(kind as FaultKind)) {
      return undefined;
    }
    parsed[host as HostId] = kind as FaultKind;
  }
  return parsed;
};
