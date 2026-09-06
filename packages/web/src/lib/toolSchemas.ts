import { EchoInputSchema } from "@bearings/shared";
import type { ZodTypeAny } from "zod";

/**
 * Tool name → the *literal* `@bearings/shared` schema the server validates with.
 * Not a copy: these are the same schema objects the registry imports, looked up
 * by name so the inspector can reject bad input with the server's own message.
 * `packages/shared` exposes no name→schema registry, so the map lives here.
 */
export const toolInputSchemas = {
  echo: EchoInputSchema,
} satisfies Record<string, ZodTypeAny>;

export type ToolName = keyof typeof toolInputSchemas;
