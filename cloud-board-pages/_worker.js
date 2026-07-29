const BOARD_ID = "shared";
const MAX_BOARD_PAYLOAD_BYTES = 512_000;
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
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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
      const row = await env.DB.prepare(
        "SELECT payload, updated_at AS updatedAt FROM board_state WHERE id = ?",
      )
        .bind(BOARD_ID)
        .first();
      return Response.json(
        row
          ? { board: JSON.parse(row.payload), updatedAt: row.updatedAt }
          : { board: null, updatedAt: 0 },
        { headers },
      );
    }
    if (request.method === "PUT") {
      const rawPayload = await request.text();
      if (
        !rawPayload ||
        new TextEncoder().encode(rawPayload).byteLength > MAX_BOARD_PAYLOAD_BYTES
      ) {
        return Response.json(
          { error: "Invalid board payload" },
          { status: 400, headers },
        );
      }
      let board;
      try {
        board = JSON.parse(rawPayload);
      } catch {
        return Response.json(
          { error: "Invalid JSON" },
          { status: 400, headers },
        );
      }
      if (!board || typeof board !== "object") {
        return Response.json(
          { error: "Invalid board state" },
          { status: 400, headers },
        );
      }
      const updatedAt = Date.now();
      await env.DB.prepare(
        `INSERT INTO board_state (id, payload, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
      )
        .bind(BOARD_ID, JSON.stringify(board), updatedAt)
        .run();
      return Response.json({ saved: true, updatedAt }, { headers });
    }
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers },
    );
  },
};
