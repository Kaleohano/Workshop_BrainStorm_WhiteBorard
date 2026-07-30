import { DurableObject } from "cloudflare:workers";

interface Env {
  DB: D1Database;
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
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

type ActionEnvelope = {
  operationId: string;
  action: BoardAction;
};

const BOARD_ID = "shared";
const ROOM_ID = "shared-layout-v4";
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

function placeNoteWithoutOverlap(notes: BoardNote[], note: BoardNote): BoardNote {
  const overlaps = (x: number, y: number) =>
    notes.some(
      (existing) =>
        Math.abs(existing.x - x) < 18 && Math.abs(existing.y - y) < 17,
    );

  if (!overlaps(note.x, note.y)) return note;

  const stepX = 20;
  const stepY = 19;
  for (let ring = 1; ring <= 30; ring += 1) {
    for (let offset = -ring; offset <= ring; offset += 1) {
      const candidates = [
        { x: note.x + offset * stepX, y: note.y - ring * stepY },
        { x: note.x + ring * stepX, y: note.y + offset * stepY },
        { x: note.x + offset * stepX, y: note.y + ring * stepY },
        { x: note.x - ring * stepX, y: note.y + offset * stepY },
      ];
      const available = candidates.find(({ x, y }) => !overlaps(x, y));
      if (available) return { ...note, ...available };
    }
  }
  return note;
}

function normalizeAction(board: BoardState, action: BoardAction): BoardAction {
  if (action.type !== "add-note") return action;
  return {
    ...action,
    note: placeNoteWithoutOverlap(board.notes, action.note),
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

export class BoardRoom extends DurableObject<Env> {
  private operationQueue: Promise<void> = Promise.resolve();
  private initialization: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS board (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS note_additions (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS note_tombstones (
          id TEXT PRIMARY KEY
        );
      `);
    });
  }

  private readStoredBoard() {
    const stored = this.ctx.storage.sql
      .exec<{ payload: string; updated_at: number }>(
        "SELECT payload, updated_at FROM board WHERE id = ?",
        BOARD_ID,
      )
      .toArray()[0];

    if (!stored) return null;
    const board = JSON.parse(stored.payload) as BoardState;
    const additions = this.ctx.storage.sql
      .exec<{ id: string; payload: string }>(
        "SELECT id, payload FROM note_additions ORDER BY sequence",
      )
      .toArray();
    const tombstones = new Set(
      this.ctx.storage.sql
        .exec<{ id: string }>("SELECT id FROM note_tombstones")
        .toArray()
        .map((row) => row.id),
    );
    const additionIds = new Set(additions.map((row) => row.id));
    const mergedNotes = board.notes.filter(
      (note) => !additionIds.has(note.id) && !tombstones.has(note.id),
    );
    for (const row of additions) {
      if (tombstones.has(row.id)) continue;
      const note = JSON.parse(row.payload) as BoardNote;
      mergedNotes.push(placeNoteWithoutOverlap(mergedNotes, note));
    }

    return {
      board: { ...board, notes: mergedNotes },
      updatedAt: stored.updated_at,
    };
  }

  private async initializeBoard() {
    if (!this.initialization) {
      this.initialization = (async () => {
        const row = await this.env.DB
          .prepare("SELECT payload, updated_at AS updatedAt FROM board_state WHERE id = ?")
          .bind(BOARD_ID)
          .first<{ payload: string; updatedAt: number }>();
        if (!row) throw new Error("Shared board has not been initialized");

        this.ctx.storage.sql.exec(
          `INSERT INTO board (id, payload, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          BOARD_ID,
          row.payload,
          row.updatedAt,
        );
      })();
    }
    await this.initialization;
  }

  private async getBoard() {
    const stored = this.readStoredBoard();
    if (stored) return stored;
    await this.initializeBoard();
    const initialized = this.readStoredBoard();
    if (!initialized) throw new Error("Shared board initialization failed");
    return initialized;
  }

  private async mutate(action: BoardAction) {
    if (action.type === "add-note") {
      this.ctx.storage.sql.exec(
        `INSERT INTO note_additions (id, payload)
         VALUES (?, ?)
         ON CONFLICT(id) DO NOTHING`,
        action.note.id,
        JSON.stringify(action.note),
      );
    } else if (action.type === "delete-note") {
      this.ctx.storage.sql.exec(
        "INSERT INTO note_tombstones (id) VALUES (?) ON CONFLICT(id) DO NOTHING",
        action.id,
      );
    } else if (action.type === "reset-board") {
      this.ctx.storage.sql.exec("DELETE FROM note_additions; DELETE FROM note_tombstones;");
    }

    let current = this.readStoredBoard();
    if (!current) {
      await this.initializeBoard();
      current = this.readStoredBoard();
    }
    if (!current) throw new Error("Shared board initialization failed");
    const normalizedAction =
      action.type === "add-note"
        ? {
            ...action,
            note:
              current.board.notes.find((note) => note.id === action.note.id) ||
              action.note,
          }
        : normalizeAction(current.board, action);
    const board =
      action.type === "add-note"
        ? current.board
        : applyAction(current.board, normalizedAction);
    const changedIds =
      action.type === "add-note" ||
      action.type === "move-note" ||
      action.type === "toggle-like"
        ? new Set([
            action.type === "add-note" ? action.note.id : action.id,
          ])
        : action.type === "tidy-notes"
          ? new Set(action.positions.map((position) => position.id))
          : new Set<string>();
    for (const note of board.notes) {
      if (!changedIds.has(note.id)) continue;
      this.ctx.storage.sql.exec(
        "UPDATE note_additions SET payload = ? WHERE id = ?",
        JSON.stringify(note),
        note.id,
      );
    }
    const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
    const payload = JSON.stringify(board);

    this.ctx.storage.sql.exec(
      `INSERT INTO board (id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      BOARD_ID,
      payload,
      updatedAt,
    );
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 250));
    return { board, updatedAt, action: normalizedAction };
  }

  private broadcast(message: string) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "Unable to deliver update");
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private applyEnvelope(envelope: ActionEnvelope) {
    if (!envelope.operationId || !envelope.action?.type) {
      return Promise.reject(new Error("Invalid action envelope"));
    }
    return this.enqueue(async () => {
      const result = await this.mutate(envelope.action);
      this.broadcast(
        JSON.stringify({
          type: "action",
          operationId: envelope.operationId,
          action: result.action,
          updatedAt: result.updatedAt,
        }),
      );
      return result.updatedAt;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const snapshot = await this.getBoard();
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "snapshot", ...snapshot }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "GET") {
      return Response.json(await this.getBoard(), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (request.method === "POST") {
      const envelope = (await request.json()) as ActionEnvelope;
      const updatedAt = await this.applyEnvelope(envelope);
      return Response.json({ saved: true, operationId: envelope.operationId, updatedAt });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      if (new TextEncoder().encode(raw).byteLength > MAX_ACTION_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }
      const envelope = JSON.parse(raw) as ActionEnvelope;
      await this.applyEnvelope(envelope);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Unable to apply action" }));
    }
  }

  async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ) {
    socket.close(code, reason);
  }

  async alarm() {
    const current = await this.getBoard();
    await this.env.DB
      .prepare(
        `INSERT INTO board_state (id, payload, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > board_state.updated_at`,
      )
      .bind(BOARD_ID, JSON.stringify(current.board), current.updatedAt)
      .run();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(request);
    if (url.pathname !== "/api/board" && url.pathname !== "/api/board/live") {
      return Response.json({ error: "Not found" }, { status: 404, headers });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (
      url.pathname === "/api/board/live" &&
      request.headers.get("Upgrade") !== "websocket"
    ) {
      return Response.json({ error: "WebSocket upgrade required" }, { status: 426, headers });
    }

    const room = env.BOARD_ROOM.getByName(ROOM_ID);
    if (url.pathname === "/api/board/live") {
      return room.fetch(request);
    }
    const response = await room.fetch(request);
    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
