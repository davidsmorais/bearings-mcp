import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toolInputSchemas } from "@bearings/shared";
import { describe, expect, it } from "vitest";

type ToolName = keyof typeof toolInputSchemas;

/**
 * The README hands a reader copy-pasteable tool-call arguments in two places: the
 * `mcp__bearings__<tool>` bullet list, and the `tools/call` JSON-RPC body in the curl
 * walkthrough. Every one of those must still validate against the tool's real schema —
 * this is the gate that stops the docs drifting from the code (the review found
 * `latitude`/`longitude` and `checkIn`/`checkOut` in examples the schemas reject).
 */

const README = readFileSync(fileURLToPath(new URL("../../../README.md", import.meta.url)), "utf8");

const isToolName = (value: string): value is ToolName => value in toolInputSchemas;

interface Example {
  readonly tool: ToolName;
  readonly source: string;
  readonly args: unknown;
}

/** Pulls `{...}` spans that sit on the same line as an `mcp__bearings__<tool>` reference. */
const bulletExamples = (): Example[] => {
  const out: Example[] = [];
  for (const line of README.split("\n")) {
    const toolMatch = line.match(/mcp__bearings__(\w+)/);
    if (!toolMatch || !isToolName(toolMatch[1])) {
      continue;
    }
    for (const span of line.matchAll(/`(\{[^`]*\})`/g)) {
      out.push({ tool: toolMatch[1], source: `bullet: ${span[1]}`, args: JSON.parse(span[1]) });
    }
  }
  return out;
};

/** Pulls `params.arguments` out of any `tools/call` JSON-RPC body in a fenced block. */
const jsonRpcExamples = (): Example[] => {
  const out: Example[] = [];
  for (const body of README.matchAll(/\{"jsonrpc":"2\.0"[^\n]*?"method":"tools\/call"[^\n]*\}/g)) {
    const parsed = JSON.parse(body[0]) as {
      params?: { name?: unknown; arguments?: unknown };
    };
    const name = parsed.params?.name;
    if (typeof name === "string" && isToolName(name)) {
      out.push({ tool: name, source: `curl: ${body[0]}`, args: parsed.params?.arguments ?? {} });
    }
  }
  return out;
};

describe("README tool-call examples", () => {
  const examples = [...bulletExamples(), ...jsonRpcExamples()];

  it("finds the expected number of documented examples", () => {
    // 4 tool bullets (echo, resolve_destination, get_destination_brief, analyse_neighbourhood)
    // + 2 tools/call bodies in the curl walkthrough. A regex that silently matches nothing
    // would make every case below vacuously pass — this is the guard against that.
    expect(examples).toHaveLength(6);
  });

  it.each(examples.map((example) => [example.source, example] as const))(
    "%s validates against its tool schema",
    (_source, example) => {
      const result = toolInputSchemas[example.tool].safeParse(example.args);
      if (!result.success) {
        throw new Error(
          `README example for ${example.tool} is rejected by its schema:\n` +
            `  ${example.source}\n  ${result.error.issues.map((i) => i.message).join("; ")}`,
        );
      }
      expect(result.success).toBe(true);
    },
  );
});
