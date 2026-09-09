import {
  FAULT_HOSTS,
  FAULT_KINDS,
  type FaultHost,
  type FaultKind,
  type FaultMap,
} from "@/hooks/useFaultInjection";

export interface FaultToggleProps {
  readonly faults: FaultMap;
  readonly onChange: (faults: FaultMap) => void;
  readonly pending: boolean;
}

/**
 * Simulates an upstream failure so the partial-result path is demonstrable without
 * unplugging the network. Rendered only when the server was started with
 * `BEARINGS_FAULT_INJECTION` — a control that cannot work should not be visible.
 *
 * Faults are per **upstream host**, which is the granularity the HTTP core knows.
 * Faulting Geoapify takes all six neighbourhood domains down together; the mixed
 * ok/unavailable case is `get_destination_brief` with one of its two upstreams faulted.
 */
export const FaultToggle = ({ faults, onChange, pending }: FaultToggleProps) => {
  const armed = Object.keys(faults).length;

  return (
    <section className="rounded border border-neutral-300 border-dashed bg-white p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-neutral-700 text-sm">
          fault injection{armed > 0 ? ` · ${armed} armed` : ""}
        </h3>
        <button
          type="button"
          onClick={() => onChange({})}
          disabled={pending || armed === 0}
          className="rounded px-2 py-0.5 font-mono text-neutral-600 text-xs hover:bg-neutral-100 disabled:opacity-40"
        >
          clear all
        </button>
      </header>

      <div className="space-y-2">
        {FAULT_HOSTS.map((host: FaultHost) => (
          <div key={host} className="flex items-center gap-2">
            <label htmlFor={`fault-${host}`} className="w-28 font-mono text-neutral-700 text-xs">
              {host}
            </label>
            <select
              id={`fault-${host}`}
              value={faults[host] ?? ""}
              disabled={pending}
              onChange={(event) => {
                const kind = event.target.value;
                const next: FaultMap = { ...faults };
                if (kind === "") {
                  delete next[host];
                } else {
                  next[host] = kind as FaultKind;
                }
                onChange(next);
              }}
              className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-neutral-900 text-xs"
            >
              <option value="">healthy</option>
              {FAULT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="mt-2 text-neutral-500 text-xs">
        A faulted host fails inside the HTTP client core, on the same path a real failure takes —
        the composition cannot tell the difference.
      </p>
    </section>
  );
};
