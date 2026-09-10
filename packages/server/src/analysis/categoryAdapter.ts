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
  // Geoapify has no `nightlife` category and no `entertainment.nightclub` leaf;
  // nightclubs sit under `adult.nightclub`. An earlier revision reached for the
  // `entertainment` *parent* instead, which was a mistake: Geoapify returns a feature's
  // full category ancestry, so `entertainment` matched every museum, theatre, cinema and
  // zoo in the radius. Counts here are per-domain and unfiltered, so those were tallied
  // as nightlife against thresholds calibrated on bars — and museums came back on the
  // culture query too, billing the same venue to two domains. Leaves only, never parents:
  // see the ALL_QUERIED_STRINGS guard below, which now makes that unrepeatable.
  nightlife: ["catering.bar", "catering.pub", "adult.nightclub"],
  groceries: ["commercial.supermarket"],
  transit: ["public_transport"],
  parks: ["leisure.park"],
  // `entertainment.cinema` belongs here, not in nightlife — the threshold note for this
  // domain reads "museums, galleries and cinemas".
  culture: [
    "entertainment.culture",
    "entertainment.museum",
    "entertainment.cinema",
    "tourism.attraction",
  ],
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

/** Every Geoapify string some domain sends upstream, paired with the domain that sends it. */
const ALL_QUERIED_STRINGS: readonly {
  readonly prefix: string;
  readonly domain: NeighbourhoodDomain;
}[] = NeighbourhoodDomainSchema.options.flatMap((domain) =>
  geoapifyStringsForDomain(domain).map((prefix) => ({ prefix, domain })),
);

/**
 * Module-load guards on the category table. Both are config-only invariants — breakable
 * by an edit to `GEOAPIFY_CATEGORY_STRINGS`, never by input — so failing at load is the
 * right severity, matching `POI_CATEGORY_TO_DOMAIN`'s double-mapping throw above.
 *
 * The second one is the guard this table needed and did not have. Geoapify returns a
 * feature's full category ancestry, so querying a parent string silently drags every
 * child into that domain: `entertainment` (nightlife) matched `entertainment.museum`
 * (culture), which meant museums and theatres were counted as nightlife *and* returned a
 * second time by the culture query, billing one venue to two domains.
 */
(() => {
  for (const { prefix, domain } of ALL_QUERIED_STRINGS) {
    const resolved = domainForGeoapifyCategories([prefix]);
    if (resolved !== domain) {
      throw new Error(
        `Geoapify category "${prefix}" is queried by "${domain}" but classifies back as ` +
          `"${resolved ?? "nothing"}"`,
      );
    }
  }

  for (const left of ALL_QUERIED_STRINGS) {
    for (const right of ALL_QUERIED_STRINGS) {
      if (left.domain === right.domain || !isDottedPrefixOf(left.prefix, right.prefix)) {
        continue;
      }
      throw new Error(
        `Geoapify category "${left.prefix}" (${left.domain}) is an ancestor of ` +
          `"${right.prefix}" (${right.domain}), so a ${left.domain} query would return ` +
          `${right.domain} venues. Query leaves, not parents.`,
      );
    }
  }
})();
