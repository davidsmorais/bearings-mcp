import { useQuery } from "@tanstack/react-query";
import { getMcpClient } from "@/lib/mcpClient";
import { toolKeys } from "@/lib/queryKeys";

/** `tools/list` — the registry is frozen at server start, so it never goes stale. */
export const useToolList = () =>
  useQuery({
    queryKey: toolKeys.list(),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const client = await getMcpClient();
      const { tools } = await client.listTools();
      return tools;
    },
  });
