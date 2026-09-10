import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Walks up from `startDir` looking for a `.env`, returning the first hit. */
function findEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Loads the nearest `.env` into process.env before any config is read.
 *
 * Two search roots, cwd first then this module's directory, because the server
 * is launched both ways: `node packages/server/dist/cli.js` from the repo root
 * (cwd wins) and spawned by Claude Desktop or an installed bin with an
 * arbitrary cwd (the module walk still finds the checkout's `.env`).
 *
 * Node's loader leaves already-set variables alone, so a real environment
 * always beats the file — a `.env` is a fallback, never an override.
 */
export function loadEnvFile(): void {
  const path = findEnvFile(process.cwd()) ?? findEnvFile(dirname(fileURLToPath(import.meta.url)));
  if (!path) {
    return;
  }

  try {
    process.loadEnvFile(path);
  } catch {
    // A malformed or unreadable .env must not stop a server whose variables are
    // already in the real environment; assertRequiredEnv reports what is missing.
  }
}

/**
 * Names both ways to supply the key, because loadEnvFile() has already looked
 * for a `.env` by the time this runs — reaching here means neither source had it.
 */
const MISSING_API_KEY_MESSAGE =
  "GEOAPIFY_API_KEY environment variable is required but not set. " +
  "Add it to a .env file at the repo root (cp .env.example .env) or export it in your shell. " +
  "Free keys: https://www.geoapify.com/";

/** Validates required environment variables before the server accepts connections. */
export function assertRequiredEnv(): void {
  if (!process.env.GEOAPIFY_API_KEY?.trim()) {
    console.error(MISSING_API_KEY_MESSAGE);
    process.exit(1);
  }
}

const DEFAULT_HTTP_PORT = 3000;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * Port the Streamable HTTP transport listens on. Defaults to 3000, matching
 * packages/web/src/lib/mcpClient.ts's DEFAULT_MCP_URL so a fresh checkout
 * connects with no configuration.
 */
export function httpPort(): number {
  const raw = process.env.BEARINGS_HTTP_PORT;
  if (!raw?.trim()) {
    return DEFAULT_HTTP_PORT;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `BEARINGS_HTTP_PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}, received "${raw}"`,
    );
  }
  return port;
}

const DEFAULT_HTTP_HOST = "127.0.0.1";

/**
 * Host the Streamable HTTP transport binds to. Loopback by default — this is
 * the actual "local dev only" guarantee, CORS is the second layer, not the first.
 */
export function httpHost(): string {
  const raw = process.env.BEARINGS_HTTP_HOST;
  return raw?.trim() || DEFAULT_HTTP_HOST;
}

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * Origins the HTTP transport's CORS layer allows, comma-separated via
 * BEARINGS_ALLOWED_ORIGINS. Defaults to Vite's dev server on both loopback
 * spellings, since the browser treats them as distinct origins.
 */
export function allowedOrigins(): string[] {
  const raw = process.env.BEARINGS_ALLOWED_ORIGINS;
  if (!raw?.trim()) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Loopback hostnames the HTTP transport always accepts in the `Host` header. `[::1]`
 * is the bracketed form a client sends for IPv6 loopback; the bare `::1` never appears
 * in a Host header.
 */
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/**
 * Hostnames the HTTP transport's `Host` header is checked against — the DNS-rebinding
 * guard. A browser page served from an attacker domain that has rebound its DNS to
 * 127.0.0.1 still sends its own hostname here, so anything outside this set is refused
 * before it reaches a tool.
 *
 * The port is deliberately not matched: the security property is about the name, and
 * the README's curl walkthrough (`:3000`), the Vite dev proxy and a direct browser hit
 * all carry a different port against the same loopback name. Defaults to loopback plus
 * whatever `BEARINGS_HTTP_HOST` resolves to; override with `BEARINGS_ALLOWED_HOSTS`
 * (comma-separated) when binding a real hostname.
 */
export function allowedHosts(): string[] {
  const raw = process.env.BEARINGS_ALLOWED_HOSTS;
  if (raw?.trim()) {
    return raw
      .split(",")
      .map((host) => host.trim())
      .filter((host) => host.length > 0);
  }
  return [...new Set([...LOOPBACK_HOSTS, httpHost()])];
}

/**
 * Whether the dev-only fault-injection seam is armed (`BEARINGS_FAULT_INJECTION`).
 *
 * Off unless the variable is set to `1` or `true`. When off, the HTTP core never consults
 * the fault registry and the transport does not register the control route at all — an
 * unset flag leaves no surface to reach, which is a stronger guarantee than a route that
 * exists and refuses. Read per call rather than cached at module load so a test can set
 * and unset it without reimporting the module.
 */
export function faultInjectionEnabled(): boolean {
  const raw = process.env.BEARINGS_FAULT_INJECTION?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
