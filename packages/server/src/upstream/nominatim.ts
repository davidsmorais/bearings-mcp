import {
  ambiguous,
  CountryCodeSchema,
  isToolError,
  type LocationCandidate,
  notFound,
  type PlaceKind,
  type ResolvedLocation,
  ResolvedLocationSchema,
  type ToolError,
  upstreamError,
} from "@bearings/shared";
import { getHttpCore, type HttpCore } from "../http/index.js";

const NOMINATIM_HOST = "nominatim";

// --- Search + disambiguation constants (root Invariant 7: named, in one block) ---
const SEARCH_PATH = "/search";
const RESPONSE_FORMAT = "jsonv2";
// Pin the response locale: without it `name`/`displayName` (and the committed
// fixtures) drift with whatever the Nominatim server's default language is.
const ACCEPT_LANGUAGE = "en";
/** Top hit must beat the runner-up's `importance` by at least this to skip the AMBIGUOUS path. */
const CONFIDENT_IMPORTANCE_GAP = 0.15;

// --- Nominatim response-format bounds (data shape, not disambiguation knobs) ---
const LAT_ABS_MAX = 90;
const LON_ABS_MAX = 180;
const PLACE_RANK_MIN = 0;
const PLACE_RANK_MAX = 30;
const BOUNDING_BOX_LENGTH = 4;

const OSM_TYPES = new Set(["node", "way", "relation"]);

/** Raw `/search` (`jsonv2`) array element. Never leaves this module. */
interface NominatimPlace {
  readonly place_id: number;
  readonly osm_type?: string;
  readonly osm_id?: number;
  readonly lat: string;
  readonly lon: string;
  readonly display_name: string;
  readonly name?: string;
  readonly addresstype?: string;
  readonly type?: string;
  readonly importance?: number;
  readonly place_rank?: number;
  readonly boundingbox?: readonly string[];
  readonly address?: {
    readonly country_code?: string;
    readonly state?: string;
    readonly region?: string;
    readonly county?: string;
    readonly municipality?: string;
    readonly city?: string;
    readonly town?: string;
    readonly village?: string;
  };
}

/** Nominatim `addresstype` → domain `PlaceKind`; anything unlisted normalises to `"other"`. */
const NOMINATIM_KIND: Record<string, PlaceKind> = {
  city: "city",
  town: "town",
  village: "village",
  suburb: "suburb",
  hamlet: "locality",
  locality: "locality",
  aerodrome: "airport",
  administrative: "region",
  country: "country",
};

const kindOf = (addresstype: string | undefined): PlaceKind =>
  addresstype === undefined ? "other" : (NOMINATIM_KIND[addresstype] ?? "other");

const osmTypeOf = (raw: string | undefined): ResolvedLocation["osmType"] =>
  raw !== undefined && OSM_TYPES.has(raw) ? (raw as ResolvedLocation["osmType"]) : undefined;

const finiteInRange = (value: string, absMax: number): number | undefined => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < -absMax || parsed > absMax) {
    return undefined;
  }
  return parsed;
};

/** Nominatim orders `boundingbox` as `[minlat, maxlat, minlon, maxlon]` = `[south, north, west, east]`. */
const parseBoundingBox = (raw: readonly string[] | undefined): ResolvedLocation["boundingBox"] => {
  if (raw === undefined || raw.length !== BOUNDING_BOX_LENGTH) {
    return undefined;
  }
  const nums = raw.map((value) => Number.parseFloat(value));
  if (nums.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  return [nums[0], nums[1], nums[2], nums[3]] as [number, number, number, number];
};

const optionalImportance = (value: number | undefined): number | undefined =>
  typeof value === "number" && value >= 0 && value <= 1 ? value : undefined;

const optionalPlaceRank = (value: number | undefined): number | undefined =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= PLACE_RANK_MIN &&
  value <= PLACE_RANK_MAX
    ? value
    : undefined;

const optionalOsmId = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

/**
 * Turns one raw hit into a `ResolvedLocation`, or drops it (`undefined`) when it
 * cannot become a valid one: a missing / malformed country code, coordinates that
 * do not parse into range, or no usable name.
 */
const normalisePlace = (raw: NominatimPlace): ResolvedLocation | undefined => {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const countryCode = CountryCodeSchema.safeParse(raw.address?.country_code?.toUpperCase());
  if (!countryCode.success) {
    return undefined;
  }

  const lat = finiteInRange(raw.lat, LAT_ABS_MAX);
  const lon = finiteInRange(raw.lon, LON_ABS_MAX);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }

  const address = raw.address ?? {};
  const state = address.state ?? address.region;
  const municipality = address.municipality ?? address.city ?? address.town ?? address.village;
  const name = (raw.name ?? raw.display_name.split(",")[0] ?? "").trim();
  if (name === "") {
    return undefined;
  }

  const importance = optionalImportance(raw.importance);
  const placeRank = optionalPlaceRank(raw.place_rank);
  const boundingBox = parseBoundingBox(raw.boundingbox);
  const osmType = osmTypeOf(raw.osm_type);
  const osmId = optionalOsmId(raw.osm_id);

  const candidate = {
    name,
    coordinates: { lat, lon },
    countryCode: countryCode.data,
    ...(raw.display_name ? { displayName: raw.display_name } : {}),
    admin: {
      ...(state ? { state } : {}),
      ...(address.county ? { county: address.county } : {}),
      ...(municipality ? { municipality } : {}),
    },
    kind: kindOf(raw.addresstype),
    ...(importance !== undefined ? { importance } : {}),
    ...(placeRank !== undefined ? { placeRank } : {}),
    ...(boundingBox !== undefined ? { boundingBox } : {}),
    ...(osmType !== undefined ? { osmType } : {}),
    ...(osmId !== undefined ? { osmId } : {}),
  };

  // Self-check the assembled shape (mirrors openMeteo's `ForecastSchema.safeParse`):
  // a hit that cannot become a valid `ResolvedLocation` is dropped like any other.
  const parsed = ResolvedLocationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
};

export interface ResolveDestinationOptions {
  /** ISO 3166-1 alpha-2 code to bias the search; sent as lower-case `countrycodes`. */
  readonly countryCode?: string;
  readonly limit: number;
  /** Injected in tests; production callers let it default to the shared singleton. */
  readonly core?: HttpCore;
  readonly signal?: AbortSignal;
}

/**
 * Forward-geocodes `query` through Nominatim and disambiguates the result set —
 * the substance of the ticket. Nominatim marks no single "best" hit, so taking
 * `results[0]` silently returns the wrong place. One surviving candidate, or a top
 * hit whose `importance` beats the runner-up by at least `CONFIDENT_IMPORTANCE_GAP`,
 * resolves confidently; anything closer returns `AMBIGUOUS` with every candidate's
 * ranking signals. No hits (or none that normalise) returns `NOT_FOUND`, never an
 * empty success.
 */
export async function resolveDestination(
  query: string,
  options: ResolveDestinationOptions,
): Promise<ResolvedLocation | ToolError> {
  const core = options.core ?? getHttpCore();
  const { countryCode, limit, signal } = options;

  const result = await core.request<unknown>(
    NOMINATIM_HOST,
    SEARCH_PATH,
    {
      q: query,
      format: RESPONSE_FORMAT,
      addressdetails: "1",
      "accept-language": ACCEPT_LANGUAGE,
      limit: String(limit),
      ...(countryCode ? { countrycodes: countryCode.toLowerCase() } : {}),
    },
    { signal },
  );
  if (isToolError(result)) {
    return result;
  }
  if (!Array.isArray(result.data)) {
    return upstreamError("Nominatim returned a non-array body", "nominatim");
  }

  const places = (result.data as NominatimPlace[])
    .map(normalisePlace)
    .filter((place): place is ResolvedLocation => place !== undefined);

  if (places.length === 0) {
    return notFound(`Nominatim found no match for "${query}"`);
  }
  if (places.length === 1) {
    return places[0] as ResolvedLocation;
  }

  // Missing `importance` sorts as 0 and so can never satisfy the gap — the query
  // falls to AMBIGUOUS, which is the safe direction.
  const ranked = [...places].sort(
    (left, right) => (right.importance ?? 0) - (left.importance ?? 0),
  );
  const [top, runnerUp] = ranked as [ResolvedLocation, ResolvedLocation];
  if (
    top.importance !== undefined &&
    top.importance - (runnerUp.importance ?? 0) >= CONFIDENT_IMPORTANCE_GAP
  ) {
    return top;
  }

  const candidates: LocationCandidate[] = ranked.slice(0, limit).map((location) => ({
    location,
    importance: location.importance ?? 0,
    kind: location.kind ?? "other",
  }));
  return ambiguous(
    `"${query}" is ambiguous — ${candidates.length} candidates, none clearly ahead; specify which`,
    candidates,
  );
}
