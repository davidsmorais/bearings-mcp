import { QueryClient } from "@tanstack/react-query";

/**
 * Retry is deliberately off: a failing Geoapify call must surface one visible
 * failure to the developer, not three silent attempts burning three credits.
 * Focus refetch is off for the same reason — a tool call is credit-spending.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
    mutations: {
      retry: false,
    },
  },
});
