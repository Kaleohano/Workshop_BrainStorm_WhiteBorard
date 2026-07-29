interface Env {
  DB: D1Database;
}

type BoardNote = {
  id: string;
  text: string;
  author: string;
  color: string;
  likes: number;
  liked: boolean;
  createdAt: number;
  x: number;
  y: number;
  tilt: number;
};

type BoardState = {
  version: 1;
  notes: BoardNote[];
  boardTitle: string;
  visitorCount: number;
};

type BoardAction =
  | { type: "add-note"; note: BoardNote }
  | { type: "delete-note"; id: string }
  | { type: "move-note"; id: string; x: number; y: number }
  | { type: "toggle-like"; id: string; delta: 1 | -1; liked: boolean }
  | { type: "tidy-notes"; positions: Array<Pick<BoardNote, "id" | "x" | "y" | "tilt">> }
  | { type: "reset-board"; boardTitle: string }
  | { type: "increment-visitor" };

const BOARD_ID = "shared";
const MAX_ACTION_BYTES = 32_000;
const ALLOWED_ORIGINS = new Set([
  "https://kaleohano.github.io",
  "https://sparkboard-ideas.itskaleohano.chatgpt.site",
]);

function corsHeaders(request: Request) {
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

function applyAction(board: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "add-note":
      if (!action.note?.id || !action.note.text?.trim()) return board;
      if (board.notes.some((note) => note.id === action.note.id)) return board;
      return { ...board, notes: [...board.notes, action.note] };
    case "delete-note":
      return { ...board, notes: board.notes.filter((note) => note.id !== action.id) };
    case "move-note":
      return {
        ...board,
        notes: board.notes.map((note) =>
          note.id === action.id ? { ...note, x: action.x, y: action.y } : note,
        ),
      };
    case "toggle-like":
      return {
        ...board,
        notes: board.notes.map((note) =>
          note.id === action.id
            ? {
                ...note,
                likes: Math.max(0, note.likes + action.delta),
                liked: action.liked,
              }
            : note,
        ),
      };
    case "tidy-notes": {
      const positions = new Map(action.positions.map((position) => [position.id, position]));
      return {
        ...board,
        notes: board.notes.map((note) => ({ ...note, ...positions.get(note.id) })),
      };
    }
    case "reset-board":
      return {
        version: 1,
        notes: [],
        boardTitle: action.boardTitle.trim().slice(0, 32) || board.boardTitle,
        visitorCount: 0,
      };
    case "increment-visitor":
      return { ...board, visitorCount: board.visitorCount + 1 };
    default:
      throw new Error("Unknown action type");
  }
}

async function mutateBoard(db: D1Database, action: BoardAction) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await db
      .prepare("SELECT payload, updated_at AS updatedAt FROM board_state WHERE id = ?")
      .bind(BOARD_ID)
      .first<{ payload: string; updatedAt: number }>();

    if (!row) throw new Error("Shared board has not been initialized");
    const board = JSON.parse(row.payload) as BoardState;
    const nextBoard = applyAction(board, action);
    const updatedAt = Math.max(Date.now(), row.updatedAt + 1);
    const result = await db
      .prepare(
        `UPDATE board_state
         SET payload = ?, updated_at = ?
         WHERE id = ? AND updated_at = ?`,
      )
      .bind(JSON.stringify(nextBoard), updatedAt, BOARD_ID, row.updatedAt)
      .run();

    if ((result.meta.changes || 0) === 1) {
      return { board: nextBoard, updatedAt };
    }
  }
  throw new Error("Board was busy; please retry");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
        .first<{ payload: string; updatedAt: number }>();
      return Response.json(
        row
          ? { board: JSON.parse(row.payload), updatedAt: row.updatedAt }
          : { board: null, updatedAt: 0 },
        { headers },
      );
    }
    if (request.method === "POST") {
      const rawPayload = await request.text();
      if (!rawPayload || new TextEncoder().encode(rawPayload).byteLength > MAX_ACTION_BYTES) {
        return Response.json({ error: "Invalid action payload" }, { status: 400, headers });
      }
      try {
        const action = JSON.parse(rawPayload) as BoardAction;
        if (!action?.type) throw new Error("Missing action type");
        return Response.json(await mutateBoard(env.DB, action), { headers });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid action";
        return Response.json({ error: message }, { status: 409, headers });
      }
    }
    return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  },
};
