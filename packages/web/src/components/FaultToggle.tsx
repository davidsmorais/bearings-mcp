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
    <section className="rounded border border-dashed border-[#1a2d42] bg-[#06101e] p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-sm text-[#7b8fa8]">
          fault injection{armed > 0 ? ` · ${armed} armed` : ""}
        </h3>
        <button
          type="button"
          onClick={() => onChange({})}
          disabled={pending || armed === 0}
          className="rounded px-2 py-0.5 font-mono text-xs text-[#7b8fa8] hover:bg-[#0e2035] hover:text-[#e0eaf5] disabled:opacity-40 transition-colors"
        >
          clear all
        </button>
      </header>

      <div className="space-y-2">
        {FAULT_HOSTS.map((host: FaultHost) => (
          <div key={host} className="flex items-center gap-2">
            <label htmlFor={`fault-${host}`} className="w-28 font-mono text-xs text-[#7b8fa8]">
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
              className="flex-1 rounded border border-[#1a2d42] bg-[#0a1829] px-2 py-1 font-mono text-xs text-[#e0eaf5] focus:border-[#00ffd5] focus:outline-none transition-colors"
            >
              <option value="" className="bg-[#0a1829] text-[#e0eaf5]">
                healthy
              </option>
              {FAULT_KINDS.map((kind) => (
                <option key={kind} value={kind} className="bg-[#0a1829] text-[#e0eaf5]">
                  {kind}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs text-[#3d4f65]">
        A faulted host fails inside the HTTP client core, on the same path a real failure takes —
        the composition cannot tell the difference.
      </p>
    </section>
  );
};
