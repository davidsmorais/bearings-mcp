#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertRequiredEnv } from "./env.js";
import { startHttpTransport } from "./transports/http.js";
import { startStdioTransport } from "./transports/stdio.js";

export type TransportMode = "stdio" | "http" | "both";

const TRANSPORT_MODES: readonly TransportMode[] = ["stdio", "http", "both"];

function isTransportMode(value: string | undefined): value is TransportMode {
  return (TRANSPORT_MODES as readonly string[]).includes(value ?? "");
}

/**
 * Reads the --transport flag. Defaults to stdio so every existing Claude
 * Desktop / Cursor config keeps working unmodified with no flag at all.
 */
export function parseTransportMode(argv: readonly string[]): TransportMode {
  const flagIndex = argv.indexOf("--transport");
  if (flagIndex === -1) {
    return "stdio";
  }

  const value = argv[flagIndex + 1];
  if (isTransportMode(value)) {
    return value;
  }

  throw new Error(
    `--transport must be one of ${TRANSPORT_MODES.join(", ")}, received "${value ?? ""}"`,
  );
}

interface TransportHandle {
  close(): Promise<void>;
}

async function main(): Promise<void> {
  assertRequiredEnv();
  const mode = parseTransportMode(process.argv);

  const handles: TransportHandle[] = [];
  if (mode === "stdio" || mode === "both") {
    handles.push(await startStdioTransport());
  }
  if (mode === "http" || mode === "both") {
    handles.push(await startHttpTransport());
  }

  const shutdown = async () => {
    await Promise.allSettled(handles.map((handle) => handle.close()));
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Same guard as stdio.ts, including realpathSync: lets cli.test.ts import
// parseTransportMode without booting a real transport, while both a direct
// `node dist/cli.js` and the symlinked package.json "bin" entry keep working —
// a symlinked bin means argv[1] is the symlink path, not the resolved one.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
