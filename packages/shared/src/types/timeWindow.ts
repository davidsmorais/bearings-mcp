import { z } from "zod";

export const MAX_STAY_NIGHTS = 30;

const nightsBetween = (start: string, end: string): number => {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return (endMs - startMs) / (1000 * 60 * 60 * 24);
};

export const TimeWindowSchema = z
  .object({
    start: z.string().date(),
    end: z.string().date(),
  })
  .refine(
    (data) => data.end >= data.start,
    (data) => ({
      message: `end must be on or after start, received end "${data.end}" with start "${data.start}"`,
    }),
  )
  .refine(
    (data) => nightsBetween(data.start, data.end) <= MAX_STAY_NIGHTS,
    (data) => {
      const nights = nightsBetween(data.start, data.end);
      return {
        message: `time window must span at most ${MAX_STAY_NIGHTS} nights, received ${nights} nights (start "${data.start}", end "${data.end}")`,
      };
    },
  );

export type TimeWindow = z.infer<typeof TimeWindowSchema>;
