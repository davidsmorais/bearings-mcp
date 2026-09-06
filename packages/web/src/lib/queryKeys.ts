/** Typed key factory so no hook hand-writes a key array. */
export const toolKeys = {
  all: ["tools"] as const,
  list: () => [...toolKeys.all, "list"] as const,
  calls: () => [...toolKeys.all, "call"] as const,
  call: (name: string, input: unknown) => [...toolKeys.calls(), name, input] as const,
};
