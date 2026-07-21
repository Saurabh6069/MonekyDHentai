import { useState, useEffect, useRef, useCallback } from "react";
import { BookOpen, Plus, Trash2, ChevronLeft, ChevronRight, Lock, X, ScrollText, Menu } from "lucide-react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const SITE_DOC = doc(db, "site", "data");

const ADMIN_PASS = "manhwa"; // demo-only client-side gate — replace with real auth before this matters to you

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
`;

const emptyData = { series: [], chapters: [] };

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export default function WebtoonSite() {
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("home"); // home | series | reader | admin
  const [seriesId, setSeriesId] = useState(null);
  const [chapterId, setChapterId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // --- persistence ---
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(SITE_DOC);
        if (snap.exists()) setData(snap.data());
      } catch (e) {
        console.error("Could not load data — check your firebaseConfig.js", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setData(next);
    try {
      await setDoc(SITE_DOC, next);
    } catch (e) {
      console.error("Could not save data — check your firebaseConfig.js and Firestore rules", e);
    }
  }, []);

  const goHome = () => { setView("home"); setMenuOpen(false); };
  const openSeries = (id) => { setSeriesId(id); setView("series"); setMenuOpen(false); };
  const openChapter = (sId, cId) => { setSeriesId(sId); setChapterId(cId); setView("reader"); setMenuOpen(false); window.scrollTo(0,0); };

  return (
    <div style={{ background: "var(--ink)", color: "var(--paper)", minHeight: "100vh", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <style>{FONTS}{`
        :root {
          --ink: #14131b;
          --surface: #1e1d29;
          --surface-2: #262533;
          --paper: #ede8dd;
          --muted: #8b879a;
          --accent: #e8542f;
          --accent-soft: rgba(232,84,47,0.14);
          --jade: #4fa8a0;
          --hairline: rgba(237,232,221,0.1);
        }
        .display { font-family: 'Black Han Sans', 'Noto Sans KR', sans-serif; letter-spacing: 0.02em; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .hairline { border-color: var(--hairline) !important; }
        .flex { display: flex; }
        .items-center { align-items: center; }
        .justify-between { justify-content: space-between; }
        .justify-center { justify-content: center; }
        a, button { -webkit-tap-highlight-color: transparent; }
        ::selection { background: var(--accent); color: var(--ink); }
        input:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      `}</style>

      <TopBar onHome={goHome} onAdmin={() => setView("admin")} view={view} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />

      {!loaded ? (
        <div className="flex items-center justify-center" style={{ height: "60vh", color: "var(--muted)" }}>Loading…</div>
      ) : view === "home" ? (
        <Home data={data} onOpenSeries={openSeries} onGoAdmin={() => setView("admin")} />
      ) : view === "series" ? (
        <SeriesPage data={data} seriesId={seriesId} onOpenChapter={openChapter} onBack={goHome} />
      ) : view === "reader" ? (
        <Reader data={data} seriesId={seriesId} chapterId={chapterId} onOpenChapter={openChapter} onBackToSeries={() => setView("series")} />
      ) : (
        <Admin data={data} persist={persist} onBack={goHome} />
      )}
    </div>
  );
}

function TopBar({ onHome, onAdmin, view, menuOpen, setMenuOpen }) {
  return (
    <header className="flex items-center justify-between hairline" style={{ borderBottom: "1px solid", padding: "18px 24px", position: "sticky", top: 0, zIndex: 30, background: "rgba(20,19,27,0.9)", backdropFilter: "blur(8px)" }}>
      <button onClick={onHome} className="flex items-center" style={{ gap: 10, background: "none", border: "none", cursor: "pointer", color: "var(--paper)" }}>
        <ScrollText size={22} color="var(--accent)" />
        <span className="display" style={{ fontSize: 22 }}>SCROLL.</span>
      </button>
      <div className="flex items-center" style={{ gap: 18 }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--muted)", display: view === "admin" ? "none" : "inline" }}>vertical stories, one panel at a time</span>
        <button onClick={onAdmin} style={{ background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--paper)", padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <Lock size={14} /> Studio
        </button>
      </div>
    </header>
  );
}

function Home({ data, onOpenSeries, onGoAdmin }) {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px 80px" }}>
      <section style={{ marginBottom: 56 }}>
        <p className="mono" style={{ color: "var(--jade)", fontSize: 13, marginBottom: 10 }}>001 — READING ROOM</p>
        <h1 className="display" style={{ fontSize: "clamp(38px, 6vw, 68px)", lineHeight: 1.05, margin: 0, maxWidth: 720 }}>
          Every panel unrolls<br/>like a scroll, top to bottom.
        </h1>
        <p style={{ color: "var(--muted)", marginTop: 16, maxWidth: 520, fontSize: 15, lineHeight: 1.6 }}>
          No pages to flip. Just scroll — the way webtoons were built to be read.
        </p>
      </section>

      {data.series.length === 0 ? (
        <EmptyState onGoAdmin={onGoAdmin} />
      ) : (
        <>
          <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.1em" }}>All Series</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 24 }}>
            {data.series.map((s) => (
              <SeriesCard key={s.id} series={s} chapterCount={data.chapters.filter(c => c.seriesId === s.id).length} onClick={() => onOpenSeries(s.id)} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function EmptyState({ onGoAdmin }) {
  return (
    <div style={{ border: "1px dashed var(--hairline)", borderRadius: 12, padding: "56px 32px", textAlign: "center" }}>
      <BookOpen size={28} color="var(--muted)" style={{ marginBottom: 14 }} />
      <p style={{ color: "var(--paper)", fontSize: 16, marginBottom: 6 }}>Nothing published yet.</p>
      <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>Add your first series in the Studio to bring readers in.</p>
      <button onClick={onGoAdmin} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "10px 20px", borderRadius: 999, fontWeight: 700, cursor: "pointer" }}>Open Studio</button>
    </div>
  );
}

function SeriesCard({ series, chapterCount, onClick }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "var(--paper)" }}>
      <div style={{ aspectRatio: "3/4", borderRadius: 8, overflow: "hidden", background: "var(--surface)", marginBottom: 10, border: "1px solid var(--hairline)" }}>
        {series.coverUrl ? (
          <img src={series.coverUrl} alt={series.title} style={{ width: "100%", height: "100%", objectFit: "cover" }}
               onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div className="flex items-center justify-center" style={{ height: "100%", color: "var(--muted)" }}><BookOpen size={24} /></div>
        )}
      </div>
      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>{series.title}</p>
      <p className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{chapterCount} EP{chapterCount === 1 ? "" : "S"}</p>
    </button>
  );
}

function SeriesPage({ data, seriesId, onOpenChapter, onBack }) {
  const series = data.series.find(s => s.id === seriesId);
  const chapters = data.chapters.filter(c => c.seriesId === seriesId).sort((a, b) => a.number - b.number);

  if (!series) return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 48, textAlign: "center" }}>
      <p style={{ color: "var(--muted)" }}>Series not found.</p>
      <button onClick={onBack} style={{ marginTop: 16, background: "var(--surface)", color: "var(--paper)", border: "1px solid var(--hairline)", padding: "8px 16px", borderRadius: 999, cursor: "pointer" }}>Back home</button>
    </main>
  );

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px 80px" }}>
      <button onClick={onBack} className="mono" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, marginBottom: 24, display: "flex", alignItems: "center", gap: 6 }}>
        <ChevronLeft size={14} /> ALL SERIES
      </button>

      <div className="flex" style={{ gap: 24, marginBottom: 40, flexWrap: "wrap" }}>
        <div style={{ width: 150, aspectRatio: "3/4", borderRadius: 8, overflow: "hidden", background: "var(--surface)", border: "1px solid var(--hairline)", flexShrink: 0 }}>
          {series.coverUrl && <img src={series.coverUrl} alt={series.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="display" style={{ fontSize: 34, margin: "0 0 10px" }}>{series.title}</h1>
          {series.genre && (
            <div className="flex" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {series.genre.split(",").map(g => g.trim()).filter(Boolean).map((g) => (
                <span key={g} className="mono" style={{ fontSize: 11, background: "var(--surface)", color: "var(--jade)", padding: "4px 10px", borderRadius: 999, border: "1px solid var(--hairline)" }}>{g}</span>
              ))}
            </div>
          )}
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, maxWidth: 480 }}>{series.description}</p>
        </div>
      </div>

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Episodes</p>
      {chapters.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>No episodes published yet.</p>
      ) : (
        <div style={{ borderTop: "1px solid var(--hairline)" }}>
          {chapters.map((c) => (
            <button key={c.id} onClick={() => onOpenChapter(series.id, c.id)} className="hairline"
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 18, padding: "18px 4px", borderBottom: "1px solid", background: "none", cursor: "pointer", color: "var(--paper)", textAlign: "left" }}>
              <span className="mono" style={{ fontSize: 20, color: "var(--accent)", width: 56, flexShrink: 0 }}>{String(c.number).padStart(2, "0")}</span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{c.title}</span>
              {c.date && <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{c.date}</span>}
              <ChevronRight size={16} color="var(--muted)" />
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

function Reader({ data, seriesId, chapterId, onOpenChapter, onBackToSeries }) {
  const containerRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const series = data.series.find(s => s.id === seriesId);
  const chapters = data.chapters.filter(c => c.seriesId === seriesId).sort((a, b) => a.number - b.number);
  const idx = chapters.findIndex(c => c.id === chapterId);
  const chapter = chapters[idx];
  const prevCh = chapters[idx - 1];
  const nextCh = chapters[idx + 1];

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0);
    };
    window.addEventListener("scroll", onScroll);
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [chapterId]);

  if (!chapter) return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 48, textAlign: "center" }}>
      <p style={{ color: "var(--muted)" }}>Episode not found.</p>
      <button onClick={onBackToSeries} style={{ marginTop: 16, background: "var(--surface)", color: "var(--paper)", border: "1px solid var(--hairline)", padding: "8px 16px", borderRadius: 999, cursor: "pointer" }}>Back</button>
    </main>
  );

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* progress rail */}
      <div style={{ position: "fixed", right: 10, top: 90, bottom: 90, width: 3, background: "var(--surface)", borderRadius: 3, zIndex: 20 }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: `${progress * 100}%`, background: "var(--accent)", borderRadius: 3, transition: "height 60ms linear" }} />
      </div>

      <div className="flex items-center justify-between" style={{ maxWidth: 780, margin: "0 auto", padding: "24px 24px 0" }}>
        <button onClick={onBackToSeries} className="mono" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <ChevronLeft size={14} /> {series?.title}
        </button>
        <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>EP. {String(chapter.number).padStart(2, "0")}</span>
      </div>

      <h2 className="display" style={{ textAlign: "center", fontSize: 22, margin: "18px 0 30px" }}>{chapter.title}</h2>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {chapter.pages.length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0" }}>No pages added to this episode yet.</p>
        ) : chapter.pages.map((url, i) => (
          <img key={i} src={url} alt={`Page ${i + 1}`} style={{ width: "100%", display: "block" }} loading="lazy"
               onError={(e) => { e.target.style.background = "var(--surface)"; e.target.style.minHeight = "200px"; }} />
        ))}
      </div>

      <div className="flex items-center justify-center" style={{ gap: 12, padding: "40px 24px 80px", maxWidth: 780, margin: "0 auto" }}>
        <NavPill disabled={!prevCh} onClick={() => prevCh && onOpenChapter(seriesId, prevCh.id)} icon={<ChevronLeft size={16} />} label="Previous" />
        <NavPill disabled={!nextCh} onClick={() => nextCh && onOpenChapter(seriesId, nextCh.id)} icon={<ChevronRight size={16} />} label="Next" trailing />
      </div>
    </div>
  );
}

function NavPill({ disabled, onClick, icon, label, trailing }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", gap: 6, flexDirection: trailing ? "row-reverse" : "row",
      background: disabled ? "var(--surface)" : "var(--accent)", color: disabled ? "var(--muted)" : "var(--ink)",
      border: "none", padding: "10px 20px", borderRadius: 999, fontWeight: 700, fontSize: 13,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1
    }}>
      {icon} {label}
    </button>
  );
}

// ---------------- ADMIN ----------------

function Admin({ data, persist, onBack }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("series");

  if (!unlocked) {
    return (
      <main style={{ maxWidth: 360, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <Lock size={26} color="var(--accent)" style={{ marginBottom: 14 }} />
        <h1 className="display" style={{ fontSize: 24, marginBottom: 18 }}>Studio Access</h1>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { pass === ADMIN_PASS ? setUnlocked(true) : setErr("Wrong password."); } }}
          placeholder="Password" style={inputStyle} />
        {err && <p style={{ color: "var(--accent)", fontSize: 12, marginTop: 8 }}>{err}</p>}
        <button onClick={() => pass === ADMIN_PASS ? setUnlocked(true) : setErr("Wrong password.")}
          style={{ marginTop: 14, width: "100%", background: "var(--accent)", color: "var(--ink)", border: "none", padding: "12px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
          Enter
        </button>
        <p className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 16 }}>Demo password: {ADMIN_PASS}</p>
        <button onClick={onBack} style={{ marginTop: 24, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>← Back to site</button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px 100px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 28 }}>
        <h1 className="display" style={{ fontSize: 30, margin: 0 }}>Studio</h1>
        <button onClick={onBack} className="mono" style={{ background: "none", border: "1px solid var(--hairline)", color: "var(--paper)", padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 12 }}>View site</button>
      </div>

      <div className="flex" style={{ gap: 8, marginBottom: 28, borderBottom: "1px solid var(--hairline)" }}>
        {["series", "chapters"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "10px 4px", marginRight: 20,
            color: tab === t ? "var(--paper)" : "var(--muted)", borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: 700, fontSize: 14, textTransform: "capitalize"
          }}>{t}</button>
        ))}
      </div>

      {tab === "series" ? <SeriesAdmin data={data} persist={persist} /> : <ChaptersAdmin data={data} persist={persist} />}
    </main>
  );
}

const inputStyle = {
  width: "100%", background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--paper)",
  padding: "11px 14px", borderRadius: 8, fontSize: 14, marginBottom: 12, fontFamily: "'Noto Sans KR', sans-serif"
};
const labelStyle = { fontSize: 12, color: "var(--muted)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.06em" };

function SeriesAdmin({ data, persist }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [cover, setCover] = useState("");
  const [genre, setGenre] = useState("");

  const addSeries = () => {
    if (!title.trim()) return;
    const next = { ...data, series: [...data.series, { id: uid("series"), title: title.trim(), description: desc.trim(), coverUrl: cover.trim(), genre: genre.trim() }] };
    persist(next);
    setTitle(""); setDesc(""); setCover(""); setGenre("");
  };

  const removeSeries = (id) => {
    const next = { series: data.series.filter(s => s.id !== id), chapters: data.chapters.filter(c => c.seriesId !== id) };
    persist(next);
  };

  return (
    <div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 20, marginBottom: 28 }}>
        <p style={{ fontWeight: 700, marginBottom: 14 }}>Add a series</p>
        <label style={labelStyle}>Title</label>
        <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Moonlit Heirs" />
        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="One or two sentences readers see on the series page." />
        <label style={labelStyle}>Cover image URL</label>
        <input style={inputStyle} value={cover} onChange={e => setCover(e.target.value)} placeholder="https://..." />
        <label style={labelStyle}>Genre tags (comma-separated)</label>
        <input style={inputStyle} value={genre} onChange={e => setGenre(e.target.value)} placeholder="Fantasy, Romance, Drama" />
        <button onClick={addSeries} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} /> Add series
        </button>
      </div>

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10, textTransform: "uppercase" }}>Existing series ({data.series.length})</p>
      {data.series.map(s => (
        <div key={s.id} className="flex items-center justify-between" style={{ padding: "12px 0", borderBottom: "1px solid var(--hairline)" }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14 }}>{s.title}</p>
            <p className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{data.chapters.filter(c => c.seriesId === s.id).length} episodes</p>
          </div>
          <button onClick={() => removeSeries(s.id)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  );
}

function ChaptersAdmin({ data, persist }) {
  const [seriesId, setSeriesId] = useState(data.series[0]?.id || "");
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [pagesText, setPagesText] = useState("");

  if (data.series.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 14 }}>Add a series first, then come back to add episodes.</p>;
  }

  const addChapter = () => {
    if (!seriesId || !number.trim() || !title.trim()) return;
    const pages = pagesText.split("\n").map(l => l.trim()).filter(Boolean);
    const next = { ...data, chapters: [...data.chapters, { id: uid("ch"), seriesId, number: Number(number), title: title.trim(), date: dateStr.trim(), pages }] };
    persist(next);
    setNumber(""); setTitle(""); setDateStr(""); setPagesText("");
  };

  const removeChapter = (id) => persist({ ...data, chapters: data.chapters.filter(c => c.id !== id) });

  const chaptersForSeries = data.chapters.filter(c => c.seriesId === seriesId).sort((a, b) => a.number - b.number);

  return (
    <div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 20, marginBottom: 28 }}>
        <p style={{ fontWeight: 700, marginBottom: 14 }}>Add an episode</p>
        <label style={labelStyle}>Series</label>
        <select style={inputStyle} value={seriesId} onChange={e => setSeriesId(e.target.value)}>
          {data.series.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Episode number</label>
            <input style={inputStyle} type="number" value={number} onChange={e => setNumber(e.target.value)} placeholder="1" />
          </div>
          <div style={{ flex: 2 }}>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="The Ink That Doesn't Fade" />
          </div>
        </div>
        <label style={labelStyle}>Publish date (optional)</label>
        <input style={inputStyle} value={dateStr} onChange={e => setDateStr(e.target.value)} placeholder="Jul 22, 2026" />
        <label style={labelStyle}>Page image URLs — one per line, in reading order</label>
        <textarea style={{ ...inputStyle, minHeight: 110, resize: "vertical", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
          value={pagesText} onChange={e => setPagesText(e.target.value)} placeholder={"https://example.com/page1.jpg\nhttps://example.com/page2.jpg"} />
        <button onClick={addChapter} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} /> Add episode
        </button>
      </div>

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10, textTransform: "uppercase" }}>Episodes in this series ({chaptersForSeries.length})</p>
      {chaptersForSeries.map(c => (
        <div key={c.id} className="flex items-center justify-between" style={{ padding: "12px 0", borderBottom: "1px solid var(--hairline)" }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14 }}>EP.{String(c.number).padStart(2, "0")} — {c.title}</p>
            <p className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{c.pages.length} pages</p>
          </div>
          <button onClick={() => removeChapter(c.id)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  );
}
