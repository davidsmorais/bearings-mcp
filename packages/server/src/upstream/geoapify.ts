import {
  type Coordinates,
  internalError,
  invalidInput,
  isToolError,
  type PoiCategory,
  type PointOfInterest,
  type ToolError,
} from "@bearings/shared";
import {
  GEOAPIFY_CATEGORY_STRINGS,
  poiCategoryForGeoapifyCategories,
} from "../analysis/categoryAdapter.js";
import { getHttpCore, type HttpCore, type RequestMeta } from "../http/index.js";

const PLACES_PATH = "/v2/places";

export const GEOAPIFY_PLACES_PER_CREDIT = 20;

/**
 * Credits a Places response consumed: 0 on a cache hit, else `ceil(returnedCount / 20)`.
 *
 * `returnedCount` is the number of features Geoapify put on the wire, counted *before*
 * `normaliseFeature` drops any that are missing an id, a name or coordinates. Geoapify
 * bills on what it returned, not on what survived normalisation — billing from the
 * post-filter `places.length` under-reports every time a feature is dropped.
 */
export const creditsForResponse = (cacheHit: boolean, returnedCount: number): number =>
  cacheHit ? 0 : Math.ceil(returnedCount / GEOAPIFY_PLACES_PER_CREDIT);

// Match openMeteo.ts: coordinates are sent (and cache-keyed) at 4 dp (~11 m) so
// sub-metre float jitter between callers doesn't fragment the cache.
const COORDINATE_DP = 4;

interface GeoapifyFeatureProperties {
  readonly name?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly formatted?: string;
  readonly place_id?: string;
  readonly distance?: number;
  readonly categories?: readonly string[];
}

interface GeoapifyFeature {
  readonly type?: string;
  readonly properties?: GeoapifyFeatureProperties;
  readonly geometry?: {
    readonly type?: string;
    readonly coordinates?: readonly [number, number];
  };
}

interface GeoapifyPlacesResponse {
  readonly type?: string;
  readonly features?: readonly GeoapifyFeature[];
}

export interface SearchPlacesInput {
  readonly coordinates: Coordinates;
  readonly radiusM: number;
  /**
   * One or more POI categories to union into a single request. Geoapify accepts
   * multiple categories per call and still bills per 20 places returned, so a
   * multi-category domain query stays one credit bucket, not one per category.
   */
  readonly categories: readonly PoiCategory[];
  // Geoapify bills 1 credit per 20 places, so limit is a cost lever, not just a page size.
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export interface SearchPlacesResult {
  readonly places: readonly PointOfInterest[];
  readonly meta: RequestMeta;
  /**
   * Feature count Geoapify returned, before normalisation dropped any. This is the
   * number `credits` is billed on — `places.length` can be lower.
   */
  readonly returnedCount: number;
  /** Geoapify credits this request consumed — 0 on a cache hit, else ceil(returnedCount / 20). */
  readonly credits: number;
}

export interface GeoapifyClientDeps {
  readonly core?: HttpCore;
}

const roundCoordinate = (value: number): string => value.toFixed(COORDINATE_DP);

const buildCircleFilter = (coordinates: Coordinates, radiusM: number): string =>
  `circle:${roundCoordinate(coordinates.lon)},${roundCoordinate(coordinates.lat)},${radiusM}`;

const buildProximityBias = (coordinates: Coordinates): string =>
  `proximity:${roundCoordinate(coordinates.lon)},${roundCoordinate(coordinates.lat)}`;

const toGeoapifyCategories = (categories: readonly PoiCategory[]): string =>
  [...new Set(categories.flatMap((category) => GEOAPIFY_CATEGORY_STRINGS[category]))].join(",");

const readCoordinates = (feature: GeoapifyFeature): Coordinates | undefined => {
  const fromProperties = feature.properties;
  if (typeof fromProperties?.lat === "number" && typeof fromProperties.lon === "number") {
    return { lat: fromProperties.lat, lon: fromProperties.lon };
  }

  const geometryCoordinates = feature.geometry?.coordinates;
  if (
    Array.isArray(geometryCoordinates) &&
    geometryCoordinates.length >= 2 &&
    typeof geometryCoordinates[0] === "number" &&
    typeof geometryCoordinates[1] === "number"
  ) {
    return { lat: geometryCoordinates[1], lon: geometryCoordinates[0] };
  }

  return undefined;
};

const normaliseFeature = (
  feature: GeoapifyFeature,
  fallbackCategory: PoiCategory,
): PointOfInterest | undefined => {
  const properties = feature.properties;
  const coordinates = readCoordinates(feature);
  const id = properties?.place_id?.trim();
  const name = properties?.name?.trim();

  if (
    id === undefined ||
    id === "" ||
    name === undefined ||
    name === "" ||
    coordinates === undefined
  ) {
    return undefined;
  }

  const address = properties?.formatted?.trim();
  const distanceM = properties?.distance;
  // Tag each POI back to a single category from its own taxonomy array; a domain
  // query unions several categories so the request-level category is only a fallback.
  const category =
    poiCategoryForGeoapifyCategories(properties?.categories ?? []) ?? fallbackCategory;

  return {
    id,
    name,
    coordinates,
    category,
    ...(address !== undefined && address !== "" ? { address } : {}),
    ...(typeof distanceM === "number" && Number.isFinite(distanceM) ? { distanceM } : {}),
  };
};

const normalisePlacesResponse = (
  body: GeoapifyPlacesResponse,
  fallbackCategory: PoiCategory,
): readonly PointOfInterest[] => {
  const features = body.features ?? [];
  const places: PointOfInterest[] = [];

  for (const feature of features) {
    const place = normaliseFeature(feature, fallbackCategory);
    if (place !== undefined) {
      places.push(place);
    }
  }

  return places;
};

export async function searchPlaces(
  input: SearchPlacesInput,
  deps: GeoapifyClientDeps = {},
): Promise<SearchPlacesResult | ToolError> {
  const { coordinates, radiusM, categories, limit, signal } = input;

  if (categories.length === 0) {
    return invalidInput("at least one category is required", "categories");
  }

  const core = deps.core ?? getHttpCore();

  const response = await core.request<GeoapifyPlacesResponse>(
    "geoapify",
    PLACES_PATH,
    {
      categories: toGeoapifyCategories(categories),
      filter: buildCircleFilter(coordinates, radiusM),
      bias: buildProximityBias(coordinates),
      limit: String(limit),
    },
    { signal },
  );

  if (isToolError(response)) {
    return response;
  }

  try {
    // Billed count is the raw feature count Geoapify sent, taken before normalisation
    // drops any. `response.data` is `unknown` at runtime — `parseResponseBody` hands back
    // raw text for a non-JSON body — so guard the shape rather than trusting the generic.
    const rawBody = response.data as { features?: unknown } | null | undefined;
    const returnedCount = Array.isArray(rawBody?.features) ? rawBody.features.length : 0;
    const places = normalisePlacesResponse(response.data, categories[0]);
    return {
      places,
      returnedCount,
      meta: response.meta,
      credits: creditsForResponse(response.meta.cacheHit, returnedCount),
    };
  } catch {
    return internalError("Failed to normalise Geoapify places response");
  }
}
