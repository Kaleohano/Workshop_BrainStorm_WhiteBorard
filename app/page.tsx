"use client";

import {
  ArrowsOut,
  CursorClick,
  DotsThree,
  HandGrabbing,
  Heart,
  Minus,
  Note,
  Plus,
  Sparkle,
  Trash,
  UsersThree,
} from "@phosphor-icons/react";
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

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

type DragState = {
  id: string;
  element: HTMLElement;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

type PanState = {
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
};

type BoardSnapshot = {
  version: 1;
  notes: BoardNote[];
  participant: string;
  boardTitle: string;
  visitorCount: number;
  draft: string;
  color: string;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
};

type SharedBoardState = {
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

const COLORS = ["butter", "rose", "blue", "green", "violet"];
const NOTE_POSITION_SCALE = 12;
const DEFAULT_BOARD_TITLE = "下一个值得尝试的点子是什么？";
const BOARD_STORAGE_KEY = "inspiration-capsule-board";
const SHARED_BOARD_URLS = [
  "https://inspiration-capsule-board-api.pages.dev/api/board",
  "https://inspiration-capsule-shared-board.inspiration-capsule.workers.dev/api/board",
];

const STARTER_NOTES: BoardNote[] = [
  {
    id: "starter-1",
    text: "如果我们的产品只能做好一件事，那会是什么？",
    author: "会发光的海獭",
    color: "butter",
    likes: 8,
    liked: false,
    createdAt: 3,
    x: 15,
    y: 18,
    tilt: -2,
  },
  {
    id: "starter-2",
    text: "做一个「反向功能」：让大家主动选择今天不做什么。",
    author: "认真散步的云",
    color: "rose",
    likes: 13,
    liked: false,
    createdAt: 2,
    x: 42,
    y: 28,
    tilt: 1,
  },
  {
    id: "starter-3",
    text: "每周五把最受欢迎的想法变成一个小实验。",
    author: "晚睡的山雀",
    color: "blue",
    likes: 5,
    liked: false,
    createdAt: 1,
    x: 68,
    y: 14,
    tilt: 2,
  },
  {
    id: "starter-4",
    text: "先写下十个不靠谱的答案，也许第十一个就是惊喜。",
    author: "慢半拍的星星",
    color: "green",
    likes: 3,
    liked: false,
    createdAt: 0,
    x: 32,
    y: 61,
    tilt: -1,
  },
];

const ADJECTIVES = ["会发光的", "爱散步的", "慢半拍的", "很认真的", "有点困的", "好奇的"];
const NOUNS = ["海獭", "山雀", "云朵", "小熊", "月亮", "松果"];

function makeName() {
  return `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}${
    NOUNS[Math.floor(Math.random() * NOUNS.length)]
  }`;
}

function getSharedBoardUrls() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? ["/api/board"]
    : SHARED_BOARD_URLS;
}

async function requestSharedBoard(init?: RequestInit) {
  let lastError: unknown;
  for (const url of getSharedBoardUrls()) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      lastError = new Error(`Shared board request failed: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Shared board is unavailable");
}

function migrateNotes(value: unknown): BoardNote[] {
  if (!Array.isArray(value)) return STARTER_NOTES;
  return value.map((item, index) => {
    const note = item as Partial<BoardNote>;
    return {
      id: note.id || crypto.randomUUID(),
      text: note.text || "",
      author: note.author || "匿名伙伴",
      color: COLORS.includes(note.color || "") ? note.color! : COLORS[index % COLORS.length],
      likes: note.likes || 0,
      liked: note.liked || false,
      createdAt: note.createdAt || index,
      x: typeof note.x === "number" ? note.x : 12 + (index % 3) * 28,
      y: typeof note.y === "number" ? note.y : 18 + Math.floor(index / 3) * 35,
      tilt: typeof note.tilt === "number" ? note.tilt : (index % 5) - 2,
    };
  });
}

export default function Home() {
  const [notes, setNotes] = useState<BoardNote[]>(STARTER_NOTES);
  const [text, setText] = useState("");
  const [participant, setParticipant] = useState("新朋友");
  const [boardTitle, setBoardTitle] = useState(DEFAULT_BOARD_TITLE);
  const [titleDraft, setTitleDraft] = useState(DEFAULT_BOARD_TITLE);
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [visitorCount, setVisitorCount] = useState(7);
  const [color, setColor] = useState(COLORS[0]);
  const [zoom, setZoom] = useState(100);
  const [tool, setTool] = useState<"select" | "pan">("select");
  const [hydrated, setHydrated] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const savedViewRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null);
  const scrollSaveFrameRef = useRef<number | null>(null);
  const latestRevisionRef = useRef(0);

  useEffect(() => {
    const savedBoard = window.localStorage.getItem(BOARD_STORAGE_KEY);
    if (savedBoard) {
      try {
        const snapshot = JSON.parse(savedBoard) as Partial<BoardSnapshot>;
        const title = snapshot.boardTitle?.trim() || DEFAULT_BOARD_TITLE;
        const name = snapshot.participant?.trim() || makeName();
        setNotes(migrateNotes(snapshot.notes));
        setParticipant(name);
        setBoardTitle(title);
        setTitleDraft(title);
        setVisitorCount(
          typeof snapshot.visitorCount === "number" ? snapshot.visitorCount : 7,
        );
        setText(typeof snapshot.draft === "string" ? snapshot.draft.slice(0, 140) : "");
        setColor(COLORS.includes(snapshot.color || "") ? snapshot.color! : COLORS[0]);
        setZoom(
          typeof snapshot.zoom === "number"
            ? Math.min(130, Math.max(70, snapshot.zoom))
            : 100,
        );
        savedViewRef.current = {
          scrollLeft:
            typeof snapshot.scrollLeft === "number" ? snapshot.scrollLeft : 0,
          scrollTop: typeof snapshot.scrollTop === "number" ? snapshot.scrollTop : 0,
        };
        window.localStorage.setItem("sparkboard-participant", name);
        setHydrated(true);
        return;
      } catch {
        window.localStorage.removeItem(BOARD_STORAGE_KEY);
      }
    }

    const savedNotes = window.localStorage.getItem("sparkboard-notes");
    const savedName = window.localStorage.getItem("sparkboard-participant");
    const savedTitle = window.localStorage.getItem("sparkboard-title");
    const savedVisitors = window.localStorage.getItem("sparkboard-visitors");
    if (savedNotes) {
      try {
        setNotes(migrateNotes(JSON.parse(savedNotes)));
      } catch {
        setNotes(STARTER_NOTES);
      }
    }
    const name = savedName || makeName();
    const title = savedTitle || DEFAULT_BOARD_TITLE;
    const visitors = savedVisitors === null ? 7 : Number.parseInt(savedVisitors, 10);
    setParticipant(name);
    setBoardTitle(title);
    setTitleDraft(title);
    setVisitorCount(Number.isNaN(visitors) ? 7 : visitors);
    window.localStorage.setItem("sparkboard-participant", name);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const viewport = viewportRef.current;
    const snapshot: BoardSnapshot = {
      version: 1,
      notes,
      participant: participant.trim() || "匿名伙伴",
      boardTitle,
      visitorCount,
      draft: text,
      color,
      zoom,
      scrollLeft: viewport?.scrollLeft || 0,
      scrollTop: viewport?.scrollTop || 0,
    };
    window.localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(snapshot));
    window.localStorage.setItem("sparkboard-notes", JSON.stringify(notes));
    window.localStorage.setItem("sparkboard-title", boardTitle);
    window.localStorage.setItem("sparkboard-visitors", String(visitorCount));
  }, [
    notes,
    participant,
    boardTitle,
    visitorCount,
    text,
    color,
    zoom,
    hydrated,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const savedView = savedViewRef.current;
      if (viewport && savedView) {
        viewport.scrollTo({
          left: savedView.scrollLeft,
          top: savedView.scrollTop,
          behavior: "auto",
        });
        savedViewRef.current = null;
      } else {
        centerCanvas("auto");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();

    function applySharedBoard(
      board: Partial<SharedBoardState> | null | undefined,
      updatedAt: number,
    ) {
      if (!board || updatedAt < latestRevisionRef.current) return;
      latestRevisionRef.current = updatedAt;
      const title = board.boardTitle?.trim() || DEFAULT_BOARD_TITLE;
      setNotes(migrateNotes(board.notes));
      setBoardTitle(title);
      setTitleDraft((current) => (current === boardTitle ? title : current));
      setVisitorCount(
        typeof board.visitorCount === "number" ? board.visitorCount : 0,
      );
    }

    async function loadSharedBoard(incrementVisitor = false) {
      try {
        const response = await requestSharedBoard({
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load shared board");
        const result = (await response.json()) as {
          board?: Partial<SharedBoardState> | null;
          updatedAt?: number;
        };
        applySharedBoard(result.board, result.updatedAt || 0);
        setCloudReady(true);
        if (incrementVisitor) void sendBoardAction({ type: "increment-visitor" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.warn("共享白板暂时无法连接，已继续使用本地内容。");
      }
    }

    void loadSharedBoard(true);
    const poll = window.setInterval(() => void loadSharedBoard(), 1500);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const saveBeforeLeaving = () => {
      saveCurrentView();
    };
    window.addEventListener("pagehide", saveBeforeLeaving);
    return () => window.removeEventListener("pagehide", saveBeforeLeaving);
  }, [hydrated, cloudReady]);

  function changeParticipant(value: string) {
    const name = value.slice(0, 14);
    setParticipant(name);
    if (name.trim()) window.localStorage.setItem("sparkboard-participant", name.trim());
  }

  async function sendBoardAction(action: BoardAction) {
    try {
      const response = await requestSharedBoard({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!response.ok) throw new Error("Unable to save shared board");
      const result = (await response.json()) as {
        board?: SharedBoardState;
        updatedAt?: number;
      };
      if (result.board && (result.updatedAt || 0) >= latestRevisionRef.current) {
        latestRevisionRef.current = result.updatedAt || 0;
        setNotes(migrateNotes(result.board.notes));
        setBoardTitle(result.board.boardTitle);
        setTitleDraft(result.board.boardTitle);
        setVisitorCount(result.board.visitorCount);
      }
    } catch {
      console.warn("共享白板暂时保存失败，本地内容仍已保留。");
    }
  }

  function requestBoardTitleChange() {
    const nextTitle = titleDraft.trim() || boardTitle;
    setTitleDraft(nextTitle);
    if (nextTitle === boardTitle) return;
    setPendingTitle(nextTitle);
  }

  function confirmBoardTitleChange() {
    if (!pendingTitle) return;
    const nextTitle = pendingTitle;
    setBoardTitle(nextTitle);
    setTitleDraft(nextTitle);
    setNotes([]);
    setText("");
    setVisitorCount(0);
    setPendingTitle(null);
    latestRevisionRef.current += 1;
    void sendBoardAction({ type: "reset-board", boardTitle: nextTitle });
    window.localStorage.setItem("sparkboard-title", nextTitle);
    window.localStorage.setItem("sparkboard-visitors", "0");
    centerCanvas();
  }

  function cancelBoardTitleChange() {
    setTitleDraft(boardTitle);
    setPendingTitle(null);
  }

  function addNote(event: FormEvent) {
    event.preventDefault();
    const idea = text.trim();
    if (!idea) return;
    const slot = notes.length;
    const note: BoardNote = {
      id: crypto.randomUUID(),
      text: idea,
      author: participant.trim() || makeName(),
      color,
      likes: 0,
      liked: false,
      createdAt: Date.now(),
      x: 14 + ((slot * 19) % 66),
      y: 16 + ((slot * 23) % 58),
      tilt: (slot % 5) - 2,
    };
    setNotes((current) => [...current, note]);
    void sendBoardAction({ type: "add-note", note });
    setText("");
    setColor(COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]);
  }

  function toggleLike(id: string) {
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    const liked = !note.liked;
    setNotes((current) =>
      current.map((note) =>
        note.id === id
          ? { ...note, liked: !note.liked, likes: note.likes + (note.liked ? -1 : 1) }
          : note,
      ),
    );
    void sendBoardAction({
      type: "toggle-like",
      id,
      delta: note.liked ? -1 : 1,
      liked,
    });
  }

  function removeNote(id: string) {
    setNotes((current) => current.filter((note) => note.id !== id));
    void sendBoardAction({ type: "delete-note", id });
  }

  function tidyNotes() {
    setNotes((current) => {
      const tidied = [...current]
        .sort((a, b) => b.likes - a.likes)
        .map((note, index) => ({
          ...note,
          x: 12 + (index % 4) * 22,
          y: 17 + Math.floor(index / 4) * 36,
          tilt: (index % 3) - 1,
        }));
      void sendBoardAction({
        type: "tidy-notes",
        positions: tidied.map(({ id, x, y, tilt }) => ({ id, x, y, tilt })),
      });
      return tidied;
    });
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, note: BoardNote) {
    if (tool !== "select") return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: note.id,
      element: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: note.x,
      startY: note.y,
    };
  }

  function startPan(event: ReactPointerEvent<HTMLElement>) {
    if (tool !== "pan") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
  }

  function moveCanvas(event: ReactPointerEvent<HTMLElement>) {
    const pan = panRef.current;
    const viewport = viewportRef.current;
    if (!pan || !viewport) return;
    viewport.scrollLeft = pan.startScrollLeft - (event.clientX - pan.startClientX);
    viewport.scrollTop = pan.startScrollTop - (event.clientY - pan.startClientY);
  }

  function endPan() {
    panRef.current = null;
    saveCurrentView();
  }

  function focusComposer() {
    setTool("select");
    inputRef.current?.focus();
  }

  function centerCanvas(behavior: ScrollBehavior = "smooth") {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      left: (viewport.scrollWidth - viewport.clientWidth) / 2,
      top: (viewport.scrollHeight - viewport.clientHeight) / 2,
      behavior,
    });
  }

  function saveCurrentView() {
    if (!hydrated) return;
    const viewport = viewportRef.current;
    const savedBoard = window.localStorage.getItem(BOARD_STORAGE_KEY);
    if (!viewport || !savedBoard) return;
    try {
      const snapshot = JSON.parse(savedBoard) as BoardSnapshot;
      window.localStorage.setItem(
        BOARD_STORAGE_KEY,
        JSON.stringify({
          ...snapshot,
          scrollLeft: viewport.scrollLeft,
          scrollTop: viewport.scrollTop,
        }),
      );
    } catch {
      // The next state update will replace an invalid snapshot.
    }
  }

  function queueCurrentViewSave() {
    if (scrollSaveFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollSaveFrameRef.current);
    }
    scrollSaveFrameRef.current = window.requestAnimationFrame(() => {
      saveCurrentView();
      scrollSaveFrameRef.current = null;
    });
  }

  function resetView() {
    setZoom(100);
    centerCanvas();
  }

  function moveNote(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.currentTarget.dataset.noteId) return;
    const scale = NOTE_POSITION_SCALE * (zoom / 100);
    const x = drag.startX + (event.clientX - drag.startClientX) / scale;
    const y = drag.startY + (event.clientY - drag.startClientY) / scale;
    drag.element.style.setProperty("--x", `${(x - 50) * NOTE_POSITION_SCALE}px`);
    drag.element.style.setProperty("--y", `${(y - 50) * NOTE_POSITION_SCALE}px`);
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.currentTarget.dataset.noteId) return;
    const xOffset = Number.parseFloat(drag.element.style.getPropertyValue("--x"));
    const yOffset = Number.parseFloat(drag.element.style.getPropertyValue("--y"));
    const x = xOffset / NOTE_POSITION_SCALE + 50;
    const y = yOffset / NOTE_POSITION_SCALE + 50;
    setNotes((current) =>
      current.map((note) =>
        note.id === drag.id
          ? { ...note, x: Number.isNaN(x) ? note.x : x, y: Number.isNaN(y) ? note.y : y }
          : note,
      ),
    );
    void sendBoardAction({
      type: "move-note",
      id: drag.id,
      x: Number.isNaN(x) ? drag.startX : x,
      y: Number.isNaN(y) ? drag.startY : y,
    });
    dragRef.current = null;
  }

  return (
    <main className="whiteboard-shell">
      <header className="board-bar">
        <div className="brand-lockup">
          <span className="brand-tile"><Sparkle weight="fill" /></span>
          <div>
            <strong>灵感胶囊</strong>
            <span>产品脑暴</span>
          </div>
        </div>

        <div className="board-title">
          <input
            aria-label="脑暴主题"
            value={titleDraft}
            maxLength={32}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={requestBoardTitleChange}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setTitleDraft(boardTitle);
                event.currentTarget.blur();
              }
            }}
          />
          <span><UsersThree /> {visitorCount} 人来过</span>
        </div>

        <div className="participant">
          <span className="avatar">{participant.trim().slice(0, 1) || "你"}</span>
          <label>
            <span>你在白板上的名字</span>
            <input
              aria-label="你在白板上的名字"
              value={participant}
              onChange={(event) => changeParticipant(event.target.value)}
              onBlur={() => {
                if (!participant.trim()) changeParticipant(makeName());
              }}
            />
          </label>
          <DotsThree weight="bold" />
        </div>
      </header>

      <aside className="tool-rail" aria-label="白板工具">
        <button
          className={tool === "select" ? "selected" : ""}
          aria-label="选择与拖动便利贴"
          aria-pressed={tool === "select"}
          data-label="选择"
          onClick={() => setTool("select")}
        >
          <CursorClick weight={tool === "select" ? "fill" : "regular"} />
        </button>
        <button
          className={tool === "pan" ? "selected" : ""}
          aria-label="拖动画布"
          aria-pressed={tool === "pan"}
          data-label="抓手"
          onClick={() => setTool("pan")}
        >
          <HandGrabbing weight={tool === "pan" ? "fill" : "regular"} />
        </button>
        <span />
        <button aria-label="新建便利贴" data-label="便利贴" onClick={focusComposer}>
          <Note weight="fill" />
        </button>
        <button aria-label="按热度整理便利贴" data-label="整理" onClick={tidyNotes}>
          <Sparkle />
        </button>
        <button aria-label="复位画布" data-label="复位" onClick={resetView}>
          <ArrowsOut />
        </button>
      </aside>

      <section
        ref={viewportRef}
        className={`canvas-viewport ${tool === "pan" ? "pan-mode" : ""}`}
        aria-label="自由脑暴白板"
        onPointerDown={startPan}
        onPointerMove={moveCanvas}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onScroll={queueCurrentViewSave}
      >
        <div className="canvas" style={{ "--zoom": zoom / 100 } as React.CSSProperties}>
          {notes.map((note) => (
            <article
              className={`sticky-note ${note.color}`}
              data-note-id={note.id}
              key={note.id}
              style={{
                "--x": `${(note.x - 50) * NOTE_POSITION_SCALE}px`,
                "--y": `${(note.y - 50) * NOTE_POSITION_SCALE}px`,
                "--tilt": `${note.tilt}deg`,
              } as React.CSSProperties}
              onPointerDown={(event) => startDrag(event, note)}
              onPointerMove={moveNote}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <div className="note-actions">
                <button onClick={() => removeNote(note.id)} aria-label={`删除点子：${note.text}`}>
                  <Trash />
                </button>
              </div>
              <p>{note.text}</p>
              <footer>
                <button
                  className={note.liked ? "liked" : ""}
                  onClick={() => toggleLike(note.id)}
                  aria-label={`${note.liked ? "取消点赞" : "点赞"}，当前 ${note.likes} 票`}
                  aria-pressed={note.liked}
                >
                  <Heart weight={note.liked ? "fill" : "regular"} />
                  {note.likes}
                </button>
                <span className="signature">{note.author}</span>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <div className="zoom-control" aria-label="画布缩放">
        <button onClick={() => setZoom((value) => Math.max(70, value - 10))} aria-label="缩小">
          <Minus />
        </button>
        <span>{zoom}%</span>
        <button onClick={() => setZoom((value) => Math.min(130, value + 10))} aria-label="放大">
          <Plus />
        </button>
        <button onClick={resetView} aria-label="恢复原始大小">
          <ArrowsOut />
        </button>
      </div>

      <form className="idea-dock" onSubmit={addNote}>
        <button type="button" className="dock-note-icon" onClick={focusComposer} aria-label="输入新点子">
          <Note weight="fill" />
        </button>
        <label>
          <span>写一张便利贴</span>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 140))}
            placeholder="输入一个想法，按 Ctrl + Enter 贴上画布"
            rows={1}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        <div className="color-picker" aria-label="便利贴颜色">
          {COLORS.map((item) => (
            <button
              key={item}
              type="button"
              className={`${item} ${color === item ? "active" : ""}`}
              onClick={() => setColor(item)}
              aria-label={`选择${item}色`}
              aria-pressed={color === item}
            />
          ))}
        </div>
        <button className="submit-note" type="submit" disabled={!text.trim()}>
          贴上去
          <Plus weight="bold" />
        </button>
      </form>

      {pendingTitle && (
        <div className="confirm-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title-heading"
            aria-describedby="confirm-title-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") cancelBoardTitleChange();
            }}
          >
            <span className="confirm-kicker">修改脑暴主题</span>
            <h2 id="confirm-title-heading">确定要换一个新主题吗？</h2>
            <p id="confirm-title-description">
              标题将改为“{pendingTitle}”。确认后，当前便利贴和观看人数会被清空，此操作无法撤销。
            </p>
            <div className="confirm-actions">
              <button type="button" onClick={cancelBoardTitleChange}>
                取消
              </button>
              <button
                type="button"
                className="confirm-primary"
                onClick={confirmBoardTitleChange}
                autoFocus
              >
                确认并清空
              </button>
            </div>
          </section>
        </div>
      )}

    </main>
  );
}
