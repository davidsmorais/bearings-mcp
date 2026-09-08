import {
  type NeighbourhoodDomain,
  NeighbourhoodDomainSchema,
  type PoiCategory,
  PoiCategorySchema,
} from "@bearings/shared";

/**
 * Geoapify's category taxonomy is documented but 400+ deep — this maps only the
 * keys the analysis layer actually queries or classifies, keyed by our seven
 * `PoiCategory` values. It lives here rather than in `upstream/geoapify.ts`
 * because it is the boundary translation between Geoapify's vocabulary and our
 * domains — the adapter the issue is named for — and `geoapify.ts` imports it back.
 * Hand-built, not captured; note it in MEMORY.md if a real response disagrees.
 */
export const GEOAPIFY_CATEGORY_STRINGS: Record<PoiCategory, readonly string[]> = {
  dining: ["catering.restaurant"],
  cafes: ["catering.cafe"],
  // `entertainment.nightclub` is a real Geoapify leaf and the clearest nightlife
  // signal after bars and pubs; included so the reverse classifier recognises it.
  nightlife: ["catering.bar", "catering.pub", "entertainment.nightclub"],
  groceries: ["commercial.supermarket"],
  transit: ["public_transport"],
  parks: ["leisure.park"],
  culture: ["entertainment.culture", "entertainment.museum", "tourism.attraction"],
};

/**
 * The 7→6 fold: `cafes` + `dining` collapse to `dining`, `parks` → `greenSpace`,
 * `groceries` → `retail`; `nightlife`, `transit`, `culture` map 1:1. Every
 * `PoiCategory` appears in exactly one domain — enforced at module load below and
 * at compile time by `_EveryCategoryMapped`.
 */
export const DOMAIN_MEMBERS: Record<NeighbourhoodDomain, readonly PoiCategory[]> = {
  nightlife: ["nightlife"],
  dining: ["cafes", "dining"],
  transit: ["transit"],
  greenSpace: ["parks"],
  retail: ["groceries"],
  culture: ["culture"],
};

type MappedCategory = (typeof DOMAIN_MEMBERS)[NeighbourhoodDomain][number];
// Compile error if a `PoiCategory` is missing from `DOMAIN_MEMBERS`, or a member
// is not a real `PoiCategory`.
type _EveryCategoryMapped = PoiCategory extends MappedCategory ? true : never;
type _EveryMemberIsACategory = MappedCategory extends PoiCategory ? true : never;
const _exhaustive: _EveryCategoryMapped & _EveryMemberIsACategory = true;
void _exhaustive;

/** Reverse lookup `PoiCategory` → its owning domain. Rejects a double-mapped category. */
const POI_CATEGORY_TO_DOMAIN: Record<PoiCategory, NeighbourhoodDomain> = (() => {
  const map = {} as Record<PoiCategory, NeighbourhoodDomain>;
  for (const domain of NeighbourhoodDomainSchema.options) {
    for (const category of DOMAIN_MEMBERS[domain]) {
      if (map[category] !== undefined) {
        throw new Error(`PoiCategory "${category}" is mapped to more than one domain`);
      }
      map[category] = domain;
    }
  }
  for (const category of PoiCategorySchema.options) {
    if (map[category] === undefined) {
      throw new Error(`PoiCategory "${category}" is not mapped to any domain`);
    }
  }
  return map;
})();

/** All known Geoapify prefixes with the `PoiCategory` they resolve to, for reverse matching. */
const KNOWN_PREFIXES: readonly { readonly prefix: string; readonly category: PoiCategory }[] =
  PoiCategorySchema.options.flatMap((category) =>
    GEOAPIFY_CATEGORY_STRINGS[category].map((prefix) => ({ prefix, category })),
  );

/** `catering.restaurant` matches known `catering.restaurant` and `catering.restaurant.pizza`. */
const isDottedPrefixOf = (known: string, actual: string): boolean =>
  actual === known || actual.startsWith(`${known}.`);

/** Union of every member category's Geoapify strings — the `categories=` value for a domain query. */
export const geoapifyStringsForDomain = (domain: NeighbourhoodDomain): readonly string[] => [
  ...new Set(DOMAIN_MEMBERS[domain].flatMap((category) => GEOAPIFY_CATEGORY_STRINGS[category])),
];

/**
 * Finer reverse map: tag a returned feature back to a single `PoiCategory`. Needed
 * because a `dining` domain query unions `catering.restaurant` + `catering.cafe`,
 * so the feature's own `categories` array is the only way to tell them apart.
 * Longest dotted-prefix match wins; an unrecognised set → `undefined`.
 */
export const poiCategoryForGeoapifyCategories = (
  strings: readonly string[],
): PoiCategory | undefined => {
  let best: { category: PoiCategory; depth: number } | undefined;
  for (const actual of strings) {
    for (const { prefix, category } of KNOWN_PREFIXES) {
      if (!isDottedPrefixOf(prefix, actual)) {
        continue;
      }
      const depth = prefix.split(".").length;
      if (best === undefined || depth > best.depth) {
        best = { category, depth };
      }
    }
  }
  return best?.category;
};

/** Reverse classifier for a returned feature's `categories` array → owning domain, or `undefined`. */
export const domainForGeoapifyCategories = (
  strings: readonly string[],
): NeighbourhoodDomain | undefined => {
  const category = poiCategoryForGeoapifyCategories(strings);
  return category === undefined ? undefined : POI_CATEGORY_TO_DOMAIN[category];
};

/**
 * The domains to actually query for a request: a domain is included when any of its
 * member categories was requested. Deduped, in `NeighbourhoodDomainSchema` order.
 */
export const domainsForRequestedCategories = (
  categories: readonly PoiCategory[],
): readonly NeighbourhoodDomain[] => {
  const requested = new Set(categories);
  return NeighbourhoodDomainSchema.options.filter((domain) =>
    DOMAIN_MEMBERS[domain].some((category) => requested.has(category)),
  );
};
