import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMcpUrl } from "@/lib/mcpClient";

/** Upstreams the server can be told to simulate a failure for. */
export const FAULT_HOSTS = ["nominatim", "open-meteo", "nager", "geoapify"] as const;
export type FaultHost = (typeof FAULT_HOSTS)[number];

export const FAULT_KINDS = ["timeout", "rate_limited", "quota_exceeded", "upstream_error"] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export type FaultMap = Partial<Record<FaultHost, FaultKind>>;

const faultKeys = { all: ["faults"] as const };

/** `/__dev/faults` sits beside `/mcp` on the same origin the MCP client talks to. */
const faultsUrl = (): string => new URL("/__dev/faults", getMcpUrl()).toString();

/**
 * Reads the server's armed faults. A 404 means the server was started without
 * `BEARINGS_FAULT_INJECTION`, which is the normal case — reported as `available: false`
 * so the UI can hide the control entirely rather than showing one that cannot work.
 */
export const useFaultInjection = () => {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: faultKeys.all,
    retry: false,
    queryFn: async (): Promise<{ available: boolean; faults: FaultMap }> => {
      const response = await fetch(faultsUrl());
      if (response.status === 404) {
        return { available: false, faults: {} };
      }
      if (!response.ok) {
        throw new Error(`fault endpoint returned ${response.status}`);
      }
      const body = (await response.json()) as { faults?: FaultMap };
      return { available: true, faults: body.faults ?? {} };
    },
  });

  const setFaults = useMutation({
    mutationFn: async (faults: FaultMap) => {
      const response = await fetch(faultsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ faults }),
      });
      if (!response.ok) {
        throw new Error(`fault endpoint rejected the map (${response.status})`);
      }
      return (await response.json()) as { faults: FaultMap };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(faultKeys.all, { available: true, faults: data.faults });
    },
  });

  return {
    available: status.data?.available ?? false,
    faults: status.data?.faults ?? {},
    isPending: status.isPending,
    setFaults,
  };
};
