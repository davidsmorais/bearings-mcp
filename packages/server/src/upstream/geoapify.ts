import {
  type Coordinates,
  internalError,
  isToolError,
  type PoiCategory,
  type PointOfInterest,
  type ToolError,
} from "@bearings/shared";
import { getHttpCore, type HttpCore, type RequestMeta } from "../http/index.js";

const PLACES_PATH = "/v2/places";

/** Maps domain POI categories to Geoapify category keys used by the analysis layer. */
const GEOAPIFY_CATEGORIES: Record<PoiCategory, readonly string[]> = {
  dining: ["catering.restaurant"],
  cafes: ["catering.cafe"],
  nightlife: ["catering.bar", "catering.pub"],
  groceries: ["commercial.supermarket"],
  transit: ["public_transport"],
  parks: ["leisure.park"],
  culture: ["entertainment.culture", "entertainment.museum", "tourism.attraction"],
};

interface GeoapifyFeatureProperties {
  readonly name?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly formatted?: string;
  readonly place_id?: string;
  readonly distance?: number;
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
  readonly category: PoiCategory;
  // Geoapify bills 1 credit per 20 places, so limit is a cost lever, not just a page size.
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export interface SearchPlacesResult {
  readonly places: readonly PointOfInterest[];
  readonly meta: RequestMeta;
}

export interface GeoapifyClientDeps {
  readonly core?: HttpCore;
}

const buildCircleFilter = (coordinates: Coordinates, radiusM: number): string =>
  `circle:${coordinates.lon},${coordinates.lat},${radiusM}`;

const buildProximityBias = (coordinates: Coordinates): string =>
  `proximity:${coordinates.lon},${coordinates.lat}`;

const toGeoapifyCategories = (category: PoiCategory): string =>
  GEOAPIFY_CATEGORIES[category].join(",");

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
  category: PoiCategory,
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
  category: PoiCategory,
): readonly PointOfInterest[] => {
  const features = body.features ?? [];
  const places: PointOfInterest[] = [];

  for (const feature of features) {
    const place = normaliseFeature(feature, category);
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
  const core = deps.core ?? getHttpCore();
  const { coordinates, radiusM, category, limit, signal } = input;

  const response = await core.request<GeoapifyPlacesResponse>(
    "geoapify",
    PLACES_PATH,
    {
      categories: toGeoapifyCategories(category),
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
    return {
      places: normalisePlacesResponse(response.data, category),
      meta: response.meta,
    };
  } catch {
    return internalError("Failed to normalise Geoapify places response");
  }
}
