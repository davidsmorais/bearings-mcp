/**
 * Measures the actual `brief` vs `full` cost of all three real tools, in both bytes and
 * the server's own `_meta["bearings/tokens"]` count. Deliberately does **not** compute a
 * second, private token estimate — the point is to measure the number an agent actually
 * receives, so a bug in the estimator or in a handler's shaping would show up here too.
 *
 * Drives the tools through `createServer()` over `InMemoryTransport`, exactly like the
 * integration test suite, with `globalThis.fetch` stubbed to the committed upstream
 * fixtures. `get_destination_brief` is wired through a custom `defineTool` (the same
 * pattern `server.integration.test.ts` already uses) so `now()` can be pinned to the
 * date the committed Open-Meteo fixture actually covers — the registered production
 * tool has no seam for that, and without it this script would silently start failing
 * every day the fixture's hourly window falls outside Open-Meteo's real horizon.
 * `resolve_destination` and `analyse_neighbourhood` run as the unmodified registry
 * tools; neither depends on the wall clock.
 *
 * Usage: `pnpm --filter @bearings/server run measure:tokens`
 */
import { type GetDestinationBriefInput, toolInputSchemas } from "@bearings/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { analyseNeighbourhoodTool } from "../src/tools/analyseNeighbourhood.js";
import { defineTool } from "../src/tools/defineTool.js";
import { composeDestinationBrief } from "../src/tools/getDestinationBrief.js";
import { resolveDestinationTool } from "../src/tools/resolveDestination.js";
import geoapifyFixture from "../test/fixtures/geoapify-places.json" with { type: "json" };
import nagerFixture from "../test/fixtures/nager.json" with { type: "json" };
import nominatimFixture from "../test/fixtures/nominatim.json" with { type: "json" };
import openMeteoFixture from "../test/fixtures/open-meteo.json" with { type: "json" };

const TOKEN_META_KEY = "bearings/tokens";

interface TokenMeta {
  readonly approximate: boolean;
  readonly tokenizer: string;
  readonly contentTokens: number;
  readonly structuredContentDuplicated: boolean;
  readonly worstCaseTokens: number;
}

// process.env.GEOAPIFY_API_KEY is read by http/config.ts's authenticateGeoapify to set
// an `apiKey` query param — the stubbed fetch below never inspects it.
process.env.GEOAPIFY_API_KEY = "measure-token-budget-dummy-key";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Routes every upstream call to the same committed fixtures the test suite uses. */
const fixtureFetch: typeof fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);

  switch (url.hostname) {
    case "nominatim.openstreetmap.org": {
      const query = (url.searchParams.get("q") ?? "").toLowerCase();
      const key = (Object.keys(nominatimFixture) as (keyof typeof nominatimFixture)[]).find(
        (candidate) => candidate !== "_note" && query.includes(candidate),
      );
      return jsonResponse(key ? nominatimFixture[key] : []);
    }
    case "api.open-meteo.com":
      return jsonResponse(openMeteoFixture);
    case "date.nager.at":
      return jsonResponse(nagerFixture.publicHolidays2026AT);
    case "api.geoapify.com":
      // Same sparse fixture for every domain query — brief vs full for this tool is
      // measured at the default limitPerCategory (20) on both sides, so the credit
      // ceiling raised in Phase 3 is a separate, unit-tested concern, not this table.
      return jsonResponse({ type: "FeatureCollection", features: geoapifyFixture.features });
    default:
      throw new Error(`measureTokenBudget: no fixture route for host "${url.hostname}"`);
  }
};

/** Pins Open-Meteo's horizon math to the date the committed fixture covers. */
const FIXTURE_NOW = () => new Date("2026-09-08T12:00:00Z");

const definitions = [
  resolveDestinationTool,
  defineTool({
    name: "get_destination_brief",
    description: "measurement wiring — see scripts/measureTokenBudget.ts",
    inputSchema: toolInputSchemas.get_destination_brief,
    handler: (input) =>
      composeDestinationBrief(input as GetDestinationBriefInput, { now: FIXTURE_NOW }),
  }),
  analyseNeighbourhoodTool,
];

interface ToolCase {
  readonly tool: string;
  readonly args: (detail: "brief" | "full") => Record<string, unknown>;
}

const CASES: readonly ToolCase[] = [
  {
    tool: "resolve_destination",
    args: (detail) => ({ query: "Lisbon", detail }),
  },
  {
    tool: "get_destination_brief",
    args: (detail) => ({
      location: {
        name: "Vienna",
        coordinates: { lat: 48.2082, lon: 16.3738 },
        countryCode: "AT",
      },
      stay: { start: "2026-09-08", end: "2026-09-10" },
      detail,
    }),
  },
  {
    tool: "analyse_neighbourhood",
    // The fixture stub ignores the actual coordinate value, so the response content is
    // identical either way — but the Geoapify cache key is not: analyse_neighbourhood
    // is the one tool whose payload reports live credit spend, and both calls sharing
    // one coordinate would make the second (whichever runs later) a free cache hit,
    // reporting 0 credits instead of the real per-call cost. A ~1km offset between the
    // two calls keeps each one a genuinely cold, independently-billed measurement.
    args: (detail) => ({
      coordinates:
        detail === "brief" ? { lat: 38.7115, lon: -9.1449 } : { lat: 38.7215, lon: -9.1549 },
      detail,
    }),
  },
];

interface Measurement {
  readonly tool: string;
  readonly detail: "brief" | "full";
  readonly bytes: number;
  readonly contentTokens: number;
  readonly worstCaseTokens: number;
  readonly credits?: number;
}

async function measure(): Promise<readonly Measurement[]> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixtureFetch;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "measure-token-budget", version: "0" });
  const server = createServer(definitions);

  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const measurements: Measurement[] = [];
    for (const testCase of CASES) {
      for (const detail of ["brief", "full"] as const) {
        const result = await client.callTool({
          name: testCase.tool,
          arguments: testCase.args(detail),
        });

        if (result.isError) {
          throw new Error(
            `measureTokenBudget: ${testCase.tool} (${detail}) returned an error: ` +
              JSON.stringify(result.structuredContent),
          );
        }

        const meta = result._meta?.[TOKEN_META_KEY] as TokenMeta | undefined;
        if (!meta) {
          throw new Error(
            `measureTokenBudget: ${testCase.tool} (${detail}) has no ${TOKEN_META_KEY}`,
          );
        }

        const textContent = Array.isArray(result.content)
          ? result.content.find(
              (block): block is { type: "text"; text: string } =>
                (block as { type?: string }).type === "text",
            )
          : undefined;
        const bytes = Buffer.byteLength(textContent?.text ?? "", "utf8");

        const structured = result.structuredContent as
          | { credits?: { consumed?: number } }
          | undefined;

        measurements.push({
          tool: testCase.tool,
          detail,
          bytes,
          contentTokens: meta.contentTokens,
          worstCaseTokens: meta.worstCaseTokens,
          credits: structured?.credits?.consumed,
        });
      }
    }
    return measurements;
  } finally {
    await client.close();
    await server.close();
    globalThis.fetch = originalFetch;
  }
}

function toMarkdownTable(measurements: readonly Measurement[]): string {
  const byTool = new Map<string, Measurement[]>();
  for (const measurement of measurements) {
    const list = byTool.get(measurement.tool) ?? [];
    list.push(measurement);
    byTool.set(measurement.tool, list);
  }

  const lines: string[] = [
    "| Tool | Detail | Bytes | Approx. tokens | Worst-case tokens | Δ vs full | Geoapify credits |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const [tool, rows] of byTool) {
    const full = rows.find((row) => row.detail === "full");
    for (const row of rows.sort((a) => (a.detail === "full" ? 1 : -1))) {
      const deltaPercent =
        full === undefined || full.contentTokens === 0
          ? 0
          : Math.round(((row.contentTokens - full.contentTokens) / full.contentTokens) * 100);
      const delta = row.detail === "full" ? "—" : `${deltaPercent}%`;
      const credits = row.credits === undefined ? "—" : String(row.credits);
      lines.push(
        `| ${tool} | ${row.detail} | ${row.bytes} | ${row.contentTokens} | ${row.worstCaseTokens} | ${delta} | ${credits} |`,
      );
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const measurements = await measure();
  console.log(toMarkdownTable(measurements));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
