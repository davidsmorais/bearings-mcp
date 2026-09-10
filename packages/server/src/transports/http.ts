import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  allowedHosts as defaultAllowedHosts,
  allowedOrigins as defaultAllowedOrigins,
  faultInjectionEnabled,
  httpHost,
  httpPort,
} from "../env.js";
import { getFaults, parseFaultMap, setFaults } from "../http/faults.js";
import { createServer } from "../server.js";

/** Ceiling on concurrent MCP sessions before `initialize` is refused. */
const DEFAULT_MAX_SESSIONS = 64;
/** A session untouched for this long is swept the next time a new one is created. */
const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;

export interface HttpTransportOptions {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  maxSessions?: number;
  sessionIdleMs?: number;
}

export interface HttpTransportHandle {
  port: number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastSeenAt: number;
}

interface AppConfig {
  origins: string[];
  hosts: string[];
  maxSessions: number;
  sessionIdleMs: number;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

/**
 * DNS-rebinding guard. Rejects any request whose `Host` header names a hostname outside
 * the allowlist, before it reaches a route. The SDK transport carries an `allowedHosts`
 * option for this but marks it deprecated in favour of exactly this — external
 * middleware — so the check sits here beside `cors`, the other browser-facing guard.
 * Port is stripped: the allowlist matches names, not names-and-ports (see `env.allowedHosts`).
 */
function hostGuard(hosts: string[]) {
  const allowed = new Set(hosts.map((host) => host.toLowerCase()));
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.host;
    const hostname = header?.replace(/:\d+$/, "").toLowerCase();
    if (hostname === undefined || !allowed.has(hostname)) {
      jsonRpcError(res, 403, `Host not allowed: ${header ?? "(none)"}`);
      return;
    }
    next();
  };
}

/** Closes and drops every session idle longer than `idleMs`. Called on each new `initialize`. */
function sweepIdleSessions(sessions: Map<string, Session>, idleMs: number, now: number): void {
  for (const [id, session] of sessions) {
    if (now - session.lastSeenAt > idleMs) {
      void session.transport.close();
      void session.server.close();
      sessions.delete(id);
    }
  }
}

function buildApp(sessions: Map<string, Session>, config: AppConfig): Express {
  const app = express();

  app.use(hostGuard(config.hosts));

  app.use(
    cors({
      origin: config.origins,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "content-type",
        "accept",
        "mcp-session-id",
        "mcp-protocol-version",
        "last-event-id",
      ],
      // The SDK client reads the session id off the initialize response headers to
      // attach it to every later call. Without exposing it here, the browser can read
      // the response body but not this header, so the client looks sessionless and
      // every subsequent POST is rejected as if initialize never happened.
      exposedHeaders: ["mcp-session-id"],
    }),
  );

  // Registered only when the flag is armed, so an unset BEARINGS_FAULT_INJECTION leaves
  // no route to reach at all — a 404, not a 403. Wiring only, like everything else in
  // this file (root Invariant 5): the fault state itself lives in src/http/.
  if (faultInjectionEnabled()) {
    app.get("/__dev/faults", (_req: Request, res: Response) => {
      res.json({ faults: getFaults() });
    });

    app.post("/__dev/faults", express.json(), (req: Request, res: Response) => {
      const parsed = parseFaultMap((req.body as { faults?: unknown } | undefined)?.faults);
      if (parsed === undefined) {
        jsonRpcError(res, 400, "Invalid fault map");
        return;
      }
      setFaults(parsed);
      res.json({ faults: getFaults() });
    });
  }

  // Scoped to POST only — express.json() in front of the GET SSE route would consume
  // a body that request never has and hang the stream waiting on one.
  app.post("/mcp", express.json(), async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        jsonRpcError(res, 404, `Unknown session: ${sessionId}`);
        return;
      }
      session.lastSeenAt = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      jsonRpcError(res, 400, "No session id provided and request is not an initialize request");
      return;
    }

    // Bound the map at exactly the moment it would otherwise grow: sweep the idle
    // entries first, then refuse if the live set is still at the ceiling. A live
    // session is never evicted to admit a new one.
    sweepIdleSessions(sessions, config.sessionIdleMs, Date.now());
    if (sessions.size >= config.maxSessions) {
      jsonRpcError(res, 503, `Session limit reached (${config.maxSessions}); try again later`);
      return;
    }

    const server = createServer();
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, lastSeenAt: Date.now() });
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) {
        sessions.delete(id);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const session = sessions.get(req.header("mcp-session-id") ?? "");
    if (!session) {
      jsonRpcError(res, 404, "Unknown session");
      return;
    }
    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const session = sessions.get(req.header("mcp-session-id") ?? "");
    if (!session) {
      jsonRpcError(res, 404, "Unknown session");
      return;
    }
    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(req, res);
  });

  // Catches anything above session/validation handling — e.g. server.connect()
  // itself failing — that would otherwise fall through to Express's default
  // handler and leak an HTML page with a stack trace instead of a JSON-RPC
  // error. Must be registered last and keep all four parameters: Express only
  // treats a handler as an error handler when its arity is 4.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    jsonRpcError(res, 500, "Internal server error");
  });

  return app;
}

/**
 * Starts the Streamable HTTP transport for the inspector. Wiring only, matching
 * stdio.ts: no tool, schema or upstream logic lives here — both transports read
 * the same createServer() registry (root Architecture Invariant 5).
 */
export async function startHttpTransport(
  options: HttpTransportOptions = {},
): Promise<HttpTransportHandle> {
  const port = options.port ?? httpPort();
  const host = options.host ?? httpHost();
  const config: AppConfig = {
    origins: options.allowedOrigins ?? defaultAllowedOrigins(),
    hosts: options.allowedHosts ?? defaultAllowedHosts(),
    maxSessions: options.maxSessions ?? DEFAULT_MAX_SESSIONS,
    sessionIdleMs: options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS,
  };

  const sessions = new Map<string, Session>();
  const app = buildApp(sessions, config);

  const httpServer = await new Promise<ReturnType<Express["listen"]>>((resolve, reject) => {
    const server = app.listen(port, host);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });

  const actualPort = (httpServer.address() as AddressInfo).port;
  console.error(`bearings-mcp http transport ready on http://${host}:${actualPort}/mcp`);

  const close = async (): Promise<void> => {
    await Promise.allSettled(
      [...sessions.values()].map(async (session) => {
        await session.transport.close();
        await session.server.close();
      }),
    );
    sessions.clear();

    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return { port: actualPort, close };
}
