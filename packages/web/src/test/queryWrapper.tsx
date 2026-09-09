import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { CallHistoryProvider } from "@/lib/callHistory";

/**
 * The provider stack the inspector's hooks run under, mirroring main.tsx. One
 * QueryClient per call, shared across every render that uses the returned wrapper — so
 * a test can remount a hook and assert the cache was reused. `CallHistoryProvider` is
 * included because `useToolCall` records into it; a wrapper without it would make every
 * hook test throw the provider-missing error instead of testing the hook.
 */
export const createQueryWrapper = (): ((props: PropsWithChildren) => ReactElement) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <CallHistoryProvider>{children}</CallHistoryProvider>
    </QueryClientProvider>
  );
};
