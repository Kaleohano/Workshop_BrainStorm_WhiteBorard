"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Note = {
  id: string;
  text: string;
  author: string;
  color: string;
  likes: number;
  liked: boolean;
  createdAt: number;
};

const COLORS = ["sun", "mint", "sky", "peach", "lilac"];

const STARTER_NOTES: Note[] = [
  {
    id: "starter-1",
    text: "如果我们的产品只能做好一件事，那会是什么？",
    author: "小北",
    color: "sun",
    likes: 8,
    liked: false,
    createdAt: 3,
  },
  {
    id: "starter-2",
    text: "做一个「反向功能」：让用户主动选择今天不做什么。",
    author: "阿卓",
    color: "mint",
    likes: 13,
    liked: false,
    createdAt: 2,
  },
  {
    id: "starter-3",
    text: "每周五把最受欢迎的想法变成一个小实验。",
    author: "Mia",
    color: "sky",
    likes: 5,
    liked: false,
    createdAt: 1,
  },
];

export default function Home() {
  const [notes, setNotes] = useState<Note[]>(STARTER_NOTES);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [sort, setSort] = useState<"new" | "popular">("new");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("sparkboard-notes");
    if (saved) {
      try {
        setNotes(JSON.parse(saved));
      } catch {
        // Keep the welcoming starter notes if saved data is unavailable.
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem("sparkboard-notes", JSON.stringify(notes));
    }
  }, [notes, hydrated]);

  const visibleNotes = useMemo(
    () =>
      [...notes].sort((a, b) =>
        sort === "popular" ? b.likes - a.likes : b.createdAt - a.createdAt,
      ),
    [notes, sort],
  );

  function addNote(event: FormEvent) {
    event.preventDefault();
    const idea = text.trim();
    if (!idea) return;

    setNotes((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        text: idea,
        author: author.trim() || "匿名伙伴",
        color,
        likes: 0,
        liked: false,
        createdAt: Date.now(),
      },
    ]);
    setText("");
    setColor(COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]);
  }

  function toggleLike(id: string) {
    setNotes((current) =>
      current.map((note) =>
        note.id === id
          ? {
              ...note,
              liked: !note.liked,
              likes: note.likes + (note.liked ? -1 : 1),
            }
          : note,
      ),
    );
  }

  function removeNote(id: string) {
    setNotes((current) => current.filter((note) => note.id !== id));
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="灵光板首页">
          <span className="brand-mark" aria-hidden="true">✦</span>
          灵光板
        </a>
        <div className="live-pill">
          <span aria-hidden="true" />
          自由脑暴中
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">IDEAS WANT COMPANY</p>
        <h1>把灵光一闪，<br /><em>留在这里。</em></h1>
        <p className="intro">
          不必完美，不用署名。写下一张便利贴，或为让你心动的点子投上一票。
        </p>

        <form className="composer" onSubmit={addNote}>
          <label htmlFor="idea">你的新点子</label>
          <textarea
            id="idea"
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 180))}
            placeholder="比如：如果我们反过来做呢？"
            rows={3}
          />
          <div className="composer-footer">
            <div className="note-options">
              <input
                aria-label="署名"
                value={author}
                onChange={(event) => setAuthor(event.target.value.slice(0, 12))}
                placeholder="你的名字（选填）"
              />
              <div className="colors" aria-label="选择便利贴颜色">
                {COLORS.map((item) => (
                  <button
                    className={`${item} ${color === item ? "selected" : ""}`}
                    key={item}
                    type="button"
                    aria-label={`选择${item}色`}
                    aria-pressed={color === item}
                    onClick={() => setColor(item)}
                  />
                ))}
              </div>
            </div>
            <button className="add-button" type="submit" disabled={!text.trim()}>
              贴上去 <span aria-hidden="true">↗</span>
            </button>
          </div>
          <span className="count">{text.length}/180</span>
        </form>
      </section>

      <section className="board" aria-label="点子便利贴墙">
        <div className="board-heading">
          <div>
            <p className="section-kicker">THE WALL</p>
            <h2>大家的想法 <sup>{notes.length}</sup></h2>
          </div>
          <div className="sorter" aria-label="排序方式">
            <button className={sort === "new" ? "active" : ""} onClick={() => setSort("new")}>
              最新
            </button>
            <button className={sort === "popular" ? "active" : ""} onClick={() => setSort("popular")}>
              最热
            </button>
          </div>
        </div>

        {visibleNotes.length ? (
          <div className="notes-grid">
            {visibleNotes.map((note, index) => (
              <article className={`note ${note.color}`} key={note.id} style={{ "--tilt": `${(index % 5) - 2}deg` } as React.CSSProperties}>
                <button className="delete" onClick={() => removeNote(note.id)} aria-label={`删除点子：${note.text}`}>
                  ×
                </button>
                <span className="quote" aria-hidden="true">“</span>
                <p>{note.text}</p>
                <footer>
                  <span>— {note.author}</span>
                  <button
                    className={note.liked ? "liked" : ""}
                    onClick={() => toggleLike(note.id)}
                    aria-label={`${note.liked ? "取消点赞" : "点赞"}，当前 ${note.likes} 票`}
                    aria-pressed={note.liked}
                  >
                    <span aria-hidden="true">{note.liked ? "♥" : "♡"}</span> {note.likes}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">
            <span aria-hidden="true">✦</span>
            <p>墙上还空着。第一个好点子，等你来贴。</p>
          </div>
        )}
      </section>

      <footer className="page-footer">
        <p>没有坏点子，只有还没被听见的点子。</p>
        {notes.length > 0 && (
          <button onClick={() => setNotes([])}>清空这块板</button>
        )}
      </footer>
    </main>
  );
}
