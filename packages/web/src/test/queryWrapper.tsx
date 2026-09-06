import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";

/**
 * One QueryClient per call, shared across every render that uses the returned
 * wrapper — so a test can remount a hook and assert the cache was reused.
 */
export const createQueryWrapper = (): ((props: PropsWithChildren) => ReactElement) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};
