import {
  type CountryCode,
  type Holiday,
  isToolError,
  notFound,
  type TimeWindow,
  type ToolError,
  ToolErrorCode,
  upstreamError,
} from "@bearings/shared";
import { getHttpCore, type HttpCore } from "../http/index.js";

const NAGER_HOST = "nager";

/** Raw shape of a Nager.Date `/PublicHolidays` array element. Never leaves this module. */
interface NagerHoliday {
  readonly date: string;
  readonly localName: string;
  readonly name: string;
  readonly countryCode: string;
}

export interface HolidayLookupOptions {
  /** Injected in tests; production callers let it default to the shared singleton. */
  readonly core?: HttpCore;
  readonly signal?: AbortSignal;
}

export interface HolidayLookup {
  /** Holidays whose date falls within the window, inclusive of both ends, sorted ascending. */
  readonly holidays: readonly Holiday[];
  /**
   * Set only when the window spanned more than one year and at least one — but not
   * every — year's fetch failed. The listed years are missing from `holidays`.
   */
  readonly partial?: {
    readonly missingYears: readonly number[];
    readonly reason: string;
  };
}

// Nager.Date serves one calendar year per request, so a window that crosses 31 December
// needs a fetch per year it touches. TimeWindow is capped well under a year — at most two.
const yearsInWindow = (window: TimeWindow): readonly number[] => {
  const startYear = Number.parseInt(window.start.slice(0, 4), 10);
  const endYear = Number.parseInt(window.end.slice(0, 4), 10);
  const years: number[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    years.push(year);
  }
  return years;
};

const normalise = (raw: NagerHoliday, countryCode: CountryCode): Holiday => ({
  date: raw.date,
  name: raw.name,
  localName: raw.localName,
  countryCode,
});

const fetchYear = async (
  core: HttpCore,
  countryCode: CountryCode,
  year: number,
  signal: AbortSignal | undefined,
): Promise<readonly NagerHoliday[] | ToolError> => {
  const result = await core.request<unknown>(
    NAGER_HOST,
    `/api/v3/PublicHolidays/${year}/${countryCode}`,
    {},
    { signal },
  );
  if (isToolError(result)) {
    return result;
  }
  if (!Array.isArray(result.data)) {
    return upstreamError(
      `Nager.Date returned a non-array body for ${countryCode} ${year}`,
      "nager",
    );
  }
  return result.data as readonly NagerHoliday[];
};

/**
 * Fetches public holidays for `countryCode` across every year `window` touches and
 * returns those inside the window, sorted by date.
 *
 * - An unsupported country code resolves to `NOT_FOUND`, never an empty list.
 * - A year-boundary window whose fetches partly fail returns the holidays it did
 *   get, plus a `partial` note naming the missing years.
 */
export async function fetchHolidaysInWindow(
  countryCode: CountryCode,
  window: TimeWindow,
  options: HolidayLookupOptions = {},
): Promise<HolidayLookup | ToolError> {
  const core = options.core ?? getHttpCore();
  const years = yearsInWindow(window);

  const settled = await Promise.allSettled(
    years.map((year) => fetchYear(core, countryCode, year, options.signal)),
  );

  const holidays: Holiday[] = [];
  const missingYears: number[] = [];
  const failures: ToolError[] = [];

  settled.forEach((outcome, index) => {
    const year = years[index] as number;
    if (outcome.status === "rejected") {
      missingYears.push(year);
      failures.push(upstreamError(`Nager.Date fetch threw for ${countryCode} ${year}`, "nager"));
      return;
    }
    if (isToolError(outcome.value)) {
      missingYears.push(year);
      failures.push(outcome.value);
      return;
    }
    for (const raw of outcome.value) {
      holidays.push(normalise(raw, countryCode));
    }
  });

  if (failures.length === years.length) {
    const unsupported = failures.some((failure) => failure.code === ToolErrorCode.NOT_FOUND);
    if (unsupported) {
      return notFound(
        `Nager.Date has no public holiday calendar for country code "${countryCode}"`,
      );
    }
    return failures[0] as ToolError;
  }

  const inWindow = holidays
    .filter((holiday) => holiday.date >= window.start && holiday.date <= window.end)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (missingYears.length === 0) {
    return { holidays: inWindow };
  }

  const noun = missingYears.length === 1 ? "that year is" : "those years are";
  return {
    holidays: inWindow,
    partial: {
      missingYears,
      reason: `Nager.Date lookup failed for ${missingYears.join(", ")}; ${noun} omitted from the results`,
    },
  };
}
