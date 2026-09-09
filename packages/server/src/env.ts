/** Validates required environment variables before the server accepts connections. */
export function assertRequiredEnv(): void {
  if (!process.env.GEOAPIFY_API_KEY?.trim()) {
    console.error("GEOAPIFY_API_KEY environment variable is required but not set");
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
