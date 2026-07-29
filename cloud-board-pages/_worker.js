const BOARD_ID = "shared";
const MAX_ACTION_BYTES = 32_000;
const REALTIME_BACKEND =
  "https://inspiration-capsule-shared-board.inspiration-capsule.workers.dev/api/board";
const ALLOWED_ORIGINS = new Set([
  "https://kaleohano.github.io",
  "https://sparkboard-ideas.itskaleohano.chatgpt.site",
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin":
      origin && ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://kaleohano.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request);
    if (url.pathname !== "/api/board") {
      return Response.json({ error: "Not found" }, { status: 404, headers });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method === "GET") {
      const row = await env.DB
        .prepare("SELECT payload, updated_at AS updatedAt FROM board_state WHERE id = ?")
        .bind(BOARD_ID)
        .first();
      return Response.json(
        row
          ? { board: JSON.parse(row.payload), updatedAt: row.updatedAt }
          : { board: null, updatedAt: 0 },
        { headers },
      );
    }
    if (request.method === "POST") {
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > MAX_ACTION_BYTES) {
        return Response.json({ error: "Action payload is too large" }, { status: 413, headers });
      }
      const response = await fetch(REALTIME_BACKEND, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: request.body,
      });
      const responseHeaders = new Headers(headers);
      responseHeaders.set("Content-Type", "application/json");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  },
};
