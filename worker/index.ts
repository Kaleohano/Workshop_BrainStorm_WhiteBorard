/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const BOARD_ID = "shared";
const MAX_BOARD_PAYLOAD_BYTES = 512_000;

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const allowedOrigin =
    origin === "https://kaleohano.github.io" ||
    origin === "https://sparkboard-ideas.itskaleohano.chatgpt.site"
      ? origin
      : "https://sparkboard-ideas.itskaleohano.chatgpt.site";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

async function ensureBoardTable(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS board_state (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
}

async function handleBoardRequest(request: Request, env: Env | undefined) {
  const headers = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (!env?.DB) {
    return Response.json(
      { error: "Shared board storage is unavailable in this environment" },
      { status: 503, headers },
    );
  }

  await ensureBoardTable(env.DB);

  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT payload, updated_at AS updatedAt FROM board_state WHERE id = ?",
    )
      .bind(BOARD_ID)
      .first<{ payload: string; updatedAt: number }>();

    return Response.json(
      row
        ? { board: JSON.parse(row.payload), updatedAt: row.updatedAt }
        : { board: null, updatedAt: 0 },
      { headers },
    );
  }

  if (request.method === "PUT") {
    const rawPayload = await request.text();
    if (!rawPayload || new TextEncoder().encode(rawPayload).byteLength > MAX_BOARD_PAYLOAD_BYTES) {
      return Response.json({ error: "Invalid board payload" }, { status: 400, headers });
    }

    let board: unknown;
    try {
      board = JSON.parse(rawPayload);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400, headers });
    }

    if (!board || typeof board !== "object") {
      return Response.json({ error: "Invalid board state" }, { status: 400, headers });
    }

    const updatedAt = Date.now();
    await env.DB.prepare(
      `INSERT INTO board_state (id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    )
      .bind(BOARD_ID, JSON.stringify(board), updatedAt)
      .run();

    return Response.json({ saved: true, updatedAt }, { headers });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405, headers });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/api/board") {
      return handleBoardRequest(request, env);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
