import { z } from "zod";

// Exempt from the "every tool accepts detail: brief|full" rule — echo is a diagnostic
// with nothing to shape, not a precedent for the real tools.
/** Input for the `echo` diagnostic tool — proves registry-to-transport wiring end to end. */
export const EchoInputSchema = z.object({
  message: z.string().min(1).max(1000).describe("The message to echo back verbatim"),
});

export type EchoInput = z.infer<typeof EchoInputSchema>;
