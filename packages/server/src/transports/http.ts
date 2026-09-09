import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { allowedOrigins as defaultAllowedOrigins, httpHost, httpPort } from "../env.js";
import { createServer } from "../server.js";

export interface HttpTransportOptions {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
}

export interface HttpTransportHandle {
  port: number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

function buildApp(sessions: Map<string, Session>, origins: string[]): Express {
  const app = express();

  app.use(
    cors({
      origin: origins,
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
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      jsonRpcError(res, 400, "No session id provided and request is not an initialize request");
      return;
    }

    const server = createServer();
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server });
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
    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const session = sessions.get(req.header("mcp-session-id") ?? "");
    if (!session) {
      jsonRpcError(res, 404, "Unknown session");
      return;
    }
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
  const origins = options.allowedOrigins ?? defaultAllowedOrigins();

  const sessions = new Map<string, Session>();
  const app = buildApp(sessions, origins);

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
