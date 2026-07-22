import { useState, useEffect, useRef, useCallback } from "react";
import { BookOpen, Plus, Trash2, ChevronLeft, ChevronRight, Lock, X, ScrollText, Menu, LogOut, Pencil, Search, Star, Bookmark, BookmarkCheck, Share2, Eye, ArrowUp, ArrowDown, MessageCircle, Upload, Download } from "lucide-react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment, arrayUnion } from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { firebaseConfig } from "./firebaseConfig";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const SITE_DOC = doc(db, "site", "data");

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
`;

const emptyData = { series: [], chapters: [], comments: [], analytics: { seriesViews: {}, chapterViews: {} }, settings: { siteTitle: "", tagline: "", logoUrl: "" } };

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

const STATUS_LABELS = { ongoing: "Ongoing", completed: "Completed", hiatus: "Hiatus" };
const STATUS_COLORS = { ongoing: "var(--jade)", completed: "var(--muted)", hiatus: "var(--accent)" };
const NEW_WINDOW_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = 60000, hr = 3600000, day = 86400000;
  if (diff < min) return "just now";
  if (diff < hr) return Math.round(diff / min) + "m ago";
  if (diff < day) return Math.round(diff / hr) + "h ago";
  if (diff < day * 30) return Math.round(diff / day) + "d ago";
  return new Date(ts).toLocaleDateString();
}

function formatCount(n) {
  n = n || 0;
  if (n >= 1000) return (n / 1000).toFixed(2) + "k";
  return String(n);
}

// --- reader-local storage (per device, no login needed) ---
const LS_BOOKMARKS = "scroll_bookmarks";
const LS_HISTORY = "scroll_history";

function getBookmarks() {
  try { return JSON.parse(localStorage.getItem(LS_BOOKMARKS)) || []; } catch { return []; }
}
function isBookmarked(id) { return getBookmarks().includes(id); }
function toggleBookmarkLS(id) {
  const cur = getBookmarks();
  const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
  try { localStorage.setItem(LS_BOOKMARKS, JSON.stringify(next)); } catch {}
  return next;
}
function getHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || {}; } catch { return {}; }
}
function recordHistory(seriesId, chapterId, chapterNumber) {
  try {
    const h = getHistory();
    h[seriesId] = { chapterId, chapterNumber, timestamp: Date.now() };
    localStorage.setItem(LS_HISTORY, JSON.stringify(h));
  } catch {}
}

// --- view analytics (best-effort, atomic increments so we never clobber other data) ---
async function trackView(field, id) {
  if (!id) return;
  try {
    await updateDoc(SITE_DOC, { [`analytics.${field}.${id}`]: increment(1) });
  } catch (e) {
    // Doc may not exist yet, or Firestore rules may block anonymous writes — non-critical, fail silently.
  }
}

// --- file uploads via Cloudinary (free tier, no credit card needed) ---
async function uploadToCloudinary(file, cloudName, uploadPreset) {
  const resourceType = file.type === "application/pdf" ? "raw" : "image";
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", uploadPreset);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok || !json.secure_url) throw new Error(json.error?.message || "Upload failed");
  return json.secure_url;
}

function UploadButton({ settings, accept, multiple, label, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const inputId = useRef("upl_" + Math.random().toString(36).slice(2));
  const cloudName = settings?.cloudinaryCloudName?.trim();
  const uploadPreset = settings?.cloudinaryUploadPreset?.trim();

  const handleChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (!cloudName || !uploadPreset) {
      alert("Add your Cloudinary cloud name and upload preset in Studio → Settings first, then try again.");
      e.target.value = "";
      return;
    }
    setBusy(true);
    try {
      const urls = [];
      for (const file of files) {
        const url = await uploadToCloudinary(file, cloudName, uploadPreset);
        urls.push(url);
      }
      onUploaded(multiple ? urls : urls[0]);
    } catch (err) {
      alert("Upload failed: " + err.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <label htmlFor={inputId.current} style={{
      display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface)", border: "1px solid var(--hairline)",
      color: "var(--paper)", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, marginBottom: 12
    }}>
      <input id={inputId.current} type="file" accept={accept} multiple={multiple} onChange={handleChange} style={{ display: "none" }} />
      <Upload size={13} /> {busy ? "Uploading…" : label}
    </label>
  );
}

function downloadBackup(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scroll-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- lightweight hash-based routing (no extra libraries, works on any static host) ---
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "series" && parts[1]) {
    if (parts[2] === "chapter" && parts[3]) return { view: "reader", seriesId: parts[1], chapterId: parts[3] };
    return { view: "series", seriesId: parts[1], chapterId: null };
  }
  if (parts[0] === "admin") return { view: "admin", seriesId: null, chapterId: null };
  return { view: "home", seriesId: null, chapterId: null };
}
function hashFor(view, seriesId, chapterId) {
  if (view === "series") return `#/series/${seriesId}`;
  if (view === "reader") return `#/series/${seriesId}/chapter/${chapterId}`;
  if (view === "admin") return "#/admin";
  return "#/";
}

export default function WebtoonSite() {
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const initialRoute = parseHash();
  const [view, setView] = useState(initialRoute.view); // home | series | reader | admin
  const [seriesId, setSeriesId] = useState(initialRoute.seriesId);
  const [chapterId, setChapterId] = useState(initialRoute.chapterId);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onHashChange = () => {
      const r = parseHash();
      setView(r.view); setSeriesId(r.seriesId); setChapterId(r.chapterId);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // --- persistence ---
  const [loadError, setLoadError] = useState(null);
  useEffect(() => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setLoadError("Timed out connecting to the database. This usually means firebaseConfig.js has placeholder values, the Firestore database hasn't been created yet, or an ad blocker is blocking the connection.");
        setLoaded(true);
      }
    }, 8000);

    (async () => {
      try {
        const snap = await getDoc(SITE_DOC);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          if (snap.exists()) setData(snap.data());
          setLoaded(true);
        }
      } catch (e) {
        console.error("Could not load data — check your firebaseConfig.js", e);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          setLoadError(e?.message || "Could not load data.");
          setLoaded(true);
        }
      }
    })();

    return () => clearTimeout(timeout);
  }, []);

  const persist = useCallback(async (next) => {
    setData(next);
    try {
      await setDoc(SITE_DOC, next);
    } catch (e) {
      console.error("Could not save data — check your firebaseConfig.js and Firestore rules", e);
    }
  }, []);

  const addComment = useCallback(async (comment) => {
    setData(prev => ({ ...prev, comments: [...(prev.comments || []), comment] }));
    try {
      await updateDoc(SITE_DOC, { comments: arrayUnion(comment) });
    } catch (e) {
      console.error("Could not save comment — check Firestore rules allow public writes to the comments field.", e);
    }
  }, []);

  const goHome = () => { window.location.hash = hashFor("home"); setMenuOpen(false); };
  const goAdmin = () => { window.location.hash = hashFor("admin"); setMenuOpen(false); };
  const openSeries = (id) => { window.location.hash = hashFor("series", id); setMenuOpen(false); };
  const openChapter = (sId, cId) => { window.location.hash = hashFor("reader", sId, cId); setMenuOpen(false); window.scrollTo(0, 0); };
  const backToSeries = () => { window.location.hash = hashFor("series", seriesId); };

  const focusSearch = () => {
    const doFocus = () => {
      const el = document.getElementById("home-search-input");
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); }
    };
    setMenuOpen(false);
    if (view !== "home") {
      window.location.hash = hashFor("home");
      setTimeout(doFocus, 60);
    } else {
      doFocus();
    }
  };

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

      <TopBar data={data} onHome={goHome} onAdmin={goAdmin} onSearchClick={focusSearch} view={view} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />

      {!loaded ? (
        <div className="flex items-center justify-center" style={{ height: "60vh", color: "var(--muted)" }}>Loading…</div>
      ) : loadError ? (
        <div className="flex items-center justify-center" style={{ height: "60vh", padding: "0 24px" }}>
          <div style={{ maxWidth: 480, textAlign: "center", color: "var(--muted)" }}>
            <p style={{ color: "var(--accent)", fontWeight: 700, marginBottom: 8 }}>Couldn't connect to the database</p>
            <p style={{ fontSize: 13, marginBottom: 16 }}>{loadError}</p>
            <button onClick={() => window.location.reload()} style={{
              background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--paper)",
              padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700
            }}>Retry</button>
          </div>
        </div>
      ) : view === "home" ? (
        <Home data={data} onOpenSeries={openSeries} onGoAdmin={goAdmin} onOpenChapter={openChapter} />
      ) : view === "series" ? (
        <SeriesPage data={data} seriesId={seriesId} onOpenChapter={openChapter} onBack={goHome} addComment={addComment} />
      ) : view === "reader" ? (
        <Reader data={data} seriesId={seriesId} chapterId={chapterId} onOpenChapter={openChapter} onBackToSeries={backToSeries} />
      ) : (
        <Admin data={data} persist={persist} onBack={goHome} />
      )}
    </div>
  );
}

function TopBar({ data, onHome, onAdmin, onSearchClick, view, menuOpen, setMenuOpen }) {
  const settings = data?.settings || {};
  const siteTitle = settings.siteTitle?.trim() || "SCROLL.";
  const tagline = settings.tagline?.trim() || "vertical stories, one panel at a time";
  const logoUrl = settings.logoUrl?.trim();

  return (
    <header className="hairline" style={{ borderBottom: "1px solid", position: "sticky", top: 0, zIndex: 30, background: "rgba(20,19,27,0.9)", backdropFilter: "blur(8px)" }}>
      <div className="flex items-center justify-between" style={{ padding: "16px 20px", gap: 14 }}>
        <div className="flex items-center" style={{ gap: 14 }}>
          <button onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu" style={{
            background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--paper)",
            width: 36, height: 36, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
          }}>
            <Menu size={17} />
          </button>
          <button onClick={onHome} className="flex items-center" style={{ gap: 10, background: "none", border: "none", cursor: "pointer", color: "var(--paper)" }}>
            {logoUrl ? (
              <img src={logoUrl} alt={siteTitle} style={{ height: 28, maxWidth: 140, objectFit: "contain", display: "block" }}
                   onError={(e) => { e.target.style.display = "none"; }} />
            ) : (
              <>
                <ScrollText size={20} color="var(--accent)" />
                <span className="display" style={{ fontSize: 20 }}>{siteTitle}</span>
              </>
            )}
          </button>
        </div>
        <div className="flex items-center" style={{ gap: 10 }}>
          <button onClick={onSearchClick} aria-label="Search" style={{
            background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--paper)",
            width: 36, height: 36, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
          }}>
            <Search size={16} />
          </button>
          <button onClick={onAdmin} aria-label="Studio" style={{ background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--paper)", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Lock size={15} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, top: 68, zIndex: 29, background: "rgba(0,0,0,0.3)" }} />
          <div style={{
            position: "absolute", top: "100%", left: 20, zIndex: 31, marginTop: 6,
            background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, overflow: "hidden",
            minWidth: 180, boxShadow: "0 12px 30px rgba(0,0,0,0.4)"
          }}>
            <button onClick={onHome} className="flex items-center" style={{ width: "100%", gap: 10, padding: "12px 16px", background: "none", border: "none", color: "var(--paper)", cursor: "pointer", fontSize: 14, textAlign: "left" }}>
              <BookOpen size={15} color="var(--muted)" /> Home
            </button>
            <button onClick={onSearchClick} className="flex items-center hairline" style={{ width: "100%", gap: 10, padding: "12px 16px", background: "none", border: "none", borderTop: "1px solid", color: "var(--paper)", cursor: "pointer", fontSize: 14, textAlign: "left" }}>
              <Search size={15} color="var(--muted)" /> Search
            </button>
            <button onClick={onAdmin} className="flex items-center hairline" style={{ width: "100%", gap: 10, padding: "12px 16px", background: "none", border: "none", borderTop: "1px solid", color: "var(--paper)", cursor: "pointer", fontSize: 14, textAlign: "left" }}>
              <Lock size={15} color="var(--muted)" /> Studio
            </button>
          </div>
        </>
      )}
    </header>
  );
}

function Home({ data, onOpenSeries, onGoAdmin, onOpenChapter }) {
  const [query, setQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState(null);
  const [bookmarks] = useState(() => getBookmarks());

  const visibleSeries = data.series.filter(s => s.status !== "draft");

  const allGenres = Array.from(new Set(
    visibleSeries.flatMap(s => (s.genre || "").split(",").map(g => g.trim()).filter(Boolean))
  ));

  const q = query.trim().toLowerCase();
  const isFiltering = Boolean(q || activeGenre);
  const filteredSeries = visibleSeries.filter(s =>
    (!q || s.title.toLowerCase().includes(q)) &&
    (!activeGenre || (s.genre || "").split(",").map(g => g.trim()).includes(activeGenre))
  );

  const now = Date.now();
  const newSeriesIds = new Set(
    data.chapters
      .filter(c => c.status !== "draft" && c.createdAt && now - c.createdAt < NEW_WINDOW_MS)
      .map(c => c.seriesId)
  );

  const history = getHistory();
  const continueList = Object.entries(history)
    .map(([sid, h]) => ({ seriesId: sid, ...h, series: data.series.find(s => s.id === sid) }))
    .filter(h => h.series && h.series.status !== "draft")
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 6);

  const bookmarkedSeries = visibleSeries.filter(s => bookmarks.includes(s.id));

  const seriesViews = data.analytics?.seriesViews || {};
  const popularSeries = [...visibleSeries]
    .sort((a, b) => (seriesViews[b.id] || 0) - (seriesViews[a.id] || 0))
    .slice(0, 8);

  const latestChapters = data.chapters
    .filter(c => c.status !== "draft" && visibleSeries.some(s => s.id === c.seriesId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 8)
    .map(c => ({ ...c, series: data.series.find(s => s.id === c.seriesId) }));

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 80px" }}>
      {visibleSeries.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div style={{ position: "relative", width: "100%", maxWidth: 340, marginBottom: allGenres.length ? 14 : 0 }}>
            <Search size={15} color="var(--muted)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input id="home-search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search series…"
              style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--paper)", padding: "10px 12px 10px 34px", borderRadius: 999, fontSize: 13 }} />
          </div>
          {allGenres.length > 0 && (
            <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
              {allGenres.map(g => (
                <button key={g} onClick={() => setActiveGenre(activeGenre === g ? null : g)} className="mono" style={{
                  fontSize: 11, padding: "5px 12px", borderRadius: 999, cursor: "pointer",
                  border: "1px solid var(--hairline)",
                  background: activeGenre === g ? "var(--accent)" : "transparent",
                  color: activeGenre === g ? "var(--ink)" : "var(--muted)"
                }}>{g}</button>
              ))}
            </div>
          )}
        </section>
      )}

      {visibleSeries.length === 0 ? (
        <EmptyState onGoAdmin={onGoAdmin} />
      ) : isFiltering ? (
        <>
          <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {filteredSeries.length} result{filteredSeries.length === 1 ? "" : "s"}
          </p>
          {filteredSeries.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>No series match your search.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 24 }}>
              {filteredSeries.map(s => (
                <SeriesCard key={s.id} series={s} chapterCount={data.chapters.filter(c => c.seriesId === s.id && c.status !== "draft").length} isNew={newSeriesIds.has(s.id)} onClick={() => onOpenSeries(s.id)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {popularSeries.length > 0 && (
            <section style={{ marginBottom: 44 }}>
              <p style={{ color: "var(--paper)", fontSize: 15, fontWeight: 800, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>Popular</p>
              <p className="mono" style={{ color: "var(--accent)", fontSize: 12, marginBottom: 14 }}>Most read</p>
              <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 6 }}>
                {popularSeries.map((s, i) => (
                  <PopularCard key={s.id} series={s} rank={i + 1} views={seriesViews[s.id] || 0} isNew={newSeriesIds.has(s.id)} onClick={() => onOpenSeries(s.id)} />
                ))}
              </div>
            </section>
          )}

          {continueList.length > 0 && (
            <section style={{ marginBottom: 44 }}>
              <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.1em" }}>Continue Reading</p>
              <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
                {continueList.map(h => (
                  <button key={h.seriesId} onClick={() => onOpenChapter(h.seriesId, h.chapterId)} style={{
                    flexShrink: 0, width: 160, background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 12, cursor: "pointer", textAlign: "left", color: "var(--paper)"
                  }}>
                    <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{h.series.title}</p>
                    <p className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>EP.{String(h.chapterNumber).padStart(2, "0")}</p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {latestChapters.length > 0 && (
            <section style={{ marginBottom: 44 }}>
              <p style={{ color: "var(--paper)", fontSize: 15, fontWeight: 800, marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>Latest Updates</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
                {latestChapters.map(c => (
                  <LatestUpdateCard key={c.id} chapter={c} onClick={() => onOpenChapter(c.seriesId, c.id)} />
                ))}
              </div>
            </section>
          )}

          {bookmarkedSeries.length > 0 && (
            <section style={{ marginBottom: 48 }}>
              <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.1em" }}>Your Bookmarks</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 24 }}>
                {bookmarkedSeries.map(s => (
                  <SeriesCard key={s.id} series={s} chapterCount={data.chapters.filter(c => c.seriesId === s.id && c.status !== "draft").length} isNew={newSeriesIds.has(s.id)} onClick={() => onOpenSeries(s.id)} />
                ))}
              </div>
            </section>
          )}

          <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.1em" }}>All Series</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 24 }}>
            {visibleSeries.map((s) => (
              <SeriesCard key={s.id} series={s} chapterCount={data.chapters.filter(c => c.seriesId === s.id && c.status !== "draft").length} isNew={newSeriesIds.has(s.id)} onClick={() => onOpenSeries(s.id)} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function PopularCard({ series, rank, views, isNew, onClick }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "var(--paper)", flexShrink: 0, width: 148 }}>
      <div style={{ position: "relative", aspectRatio: "3/4", borderRadius: 8, overflow: "hidden", background: "var(--surface)", marginBottom: 10, border: "1px solid var(--hairline)" }}>
        {series.coverUrl ? (
          <img src={series.coverUrl} alt={series.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
               onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div className="flex items-center justify-center" style={{ height: "100%", color: "var(--muted)" }}><BookOpen size={24} /></div>
        )}
        <span className="mono" style={{
          position: "absolute", top: 8, left: 8, background: rank <= 3 ? "var(--accent)" : "rgba(20,19,27,0.85)",
          color: rank <= 3 ? "var(--ink)" : "var(--paper)", fontSize: 12, fontWeight: 700,
          width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center"
        }}>{rank}</span>
      </div>
      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{series.title}</p>
      <p className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{formatCount(views)} views</p>
      {(rank <= 3 || isNew) && (
        <div className="flex items-center" style={{ gap: 5 }}>
          {rank <= 3 && (
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--ink)", background: "var(--accent)", padding: "2px 8px", borderRadius: 5 }}>TOP</span>
          )}
          {isNew && (
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--ink)", background: "#e0435c", padding: "2px 8px", borderRadius: 5 }}>NEW</span>
          )}
        </div>
      )}
    </button>
  );
}

function LatestUpdateCard({ chapter: c, onClick }) {
  const pageCount = Array.isArray(c.pages) ? c.pages.length : 0;
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "var(--paper)" }}>
      <div style={{ position: "relative", aspectRatio: "3/4", borderRadius: 8, overflow: "hidden", background: "var(--surface)", marginBottom: 10, border: "1px solid var(--hairline)" }}>
        {c.series?.coverUrl ? (
          <img src={c.series.coverUrl} alt={c.series.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
               onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div className="flex items-center justify-center" style={{ height: "100%", color: "var(--muted)" }}><BookOpen size={24} /></div>
        )}
      </div>
      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{c.series?.title}</p>
      <div className="flex items-center justify-between" style={{ borderLeft: "2px solid var(--jade)", paddingLeft: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>
          <span className="mono" style={{ fontWeight: 700 }}>EP.{String(c.number).padStart(2, "0")}</span>
          {pageCount > 0 && <span className="mono" style={{ color: "var(--muted)" }}> · {pageCount}pg</span>}
        </span>
        <ChevronRight size={13} color="var(--muted)" />
      </div>
      <p className="mono" style={{ fontSize: 11, color: "var(--muted)", paddingLeft: 10 }}>{c.createdAt ? timeAgo(c.createdAt) : ""}</p>
    </button>
  );
}

function EmptyState({ onGoAdmin }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px" }}>
      <BookOpen size={22} color="var(--muted)" style={{ marginBottom: 12 }} />
      <p style={{ color: "var(--paper)", fontSize: 15, marginBottom: 4 }}>Nothing published yet.</p>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>Add your first series in the Studio to bring readers in.</p>
      <button onClick={onGoAdmin} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "9px 18px", borderRadius: 999, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Open Studio</button>
    </div>
  );
}

function SeriesCard({ series, chapterCount, isNew, onClick }) {
  const statusLabel = STATUS_LABELS[series.seriesStatus];
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "var(--paper)" }}>
      <div style={{ position: "relative", aspectRatio: "3/4", borderRadius: 8, overflow: "hidden", background: "var(--surface)", marginBottom: 10, border: "1px solid var(--hairline)" }}>
        {series.coverUrl ? (
          <img src={series.coverUrl} alt={series.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
               onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div className="flex items-center justify-center" style={{ height: "100%", color: "var(--muted)" }}><BookOpen size={24} /></div>
        )}
        {isNew && (
          <span className="mono" style={{ position: "absolute", top: 8, left: 8, background: "var(--accent)", color: "var(--ink)", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>NEW</span>
        )}
      </div>
      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>{series.title}</p>
      <div className="flex items-center" style={{ gap: 6 }}>
        <p className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{chapterCount} EP{chapterCount === 1 ? "" : "S"}</p>
        {statusLabel && <span className="mono" style={{ fontSize: 10, color: STATUS_COLORS[series.seriesStatus] }}>• {statusLabel}</span>}
      </div>
    </button>
  );
}

function SeriesPage({ data, seriesId, onOpenChapter, onBack, addComment }) {
  const series = data.series.find(s => s.id === seriesId);
  const chapters = data.chapters.filter(c => c.seriesId === seriesId && c.status !== "draft").sort((a, b) => a.number - b.number);
  const [bookmarked, setBookmarked] = useState(() => isBookmarked(seriesId));
  const [shared, setShared] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [rating, setRating] = useState(0);

  useEffect(() => {
    if (seriesId) trackView("seriesViews", seriesId);
  }, [seriesId]);

  if (!series) return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 48, textAlign: "center" }}>
      <p style={{ color: "var(--muted)" }}>Series not found.</p>
      <button onClick={onBack} style={{ marginTop: 16, background: "var(--surface)", color: "var(--paper)", border: "1px solid var(--hairline)", padding: "8px 16px", borderRadius: 999, cursor: "pointer" }}>Back home</button>
    </main>
  );

  const comments = (data.comments || []).filter(c => c.seriesId === seriesId).sort((a, b) => b.createdAt - a.createdAt);
  const ratings = comments.filter(c => c.rating).map(c => c.rating);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const statusLabel = STATUS_LABELS[series.seriesStatus];

  const toggleBookmark = () => setBookmarked(toggleBookmarkLS(seriesId).includes(seriesId));

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: series.title, url }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(url); setShared(true); setTimeout(() => setShared(false), 2000); } catch {}
    }
  };

  const submitComment = () => {
    if (!text.trim()) return;
    addComment({ id: uid("cm"), seriesId, name: name.trim() || "Anonymous", text: text.trim(), rating: rating || null, createdAt: Date.now() });
    setText(""); setRating(0);
  };

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px 80px" }}>
      <button onClick={onBack} className="mono" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, marginBottom: 24, display: "flex", alignItems: "center", gap: 6 }}>
        <ChevronLeft size={14} /> ALL SERIES
      </button>

      <div className="flex" style={{ gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 150, aspectRatio: "3/4", borderRadius: 8, overflow: "hidden", background: "var(--surface)", border: "1px solid var(--hairline)", flexShrink: 0 }}>
          {series.coverUrl && <img src={series.coverUrl} alt={series.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="display" style={{ fontSize: 34, margin: "0 0 10px" }}>{series.title}</h1>
          <div className="flex items-center" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {series.genre && series.genre.split(",").map(g => g.trim()).filter(Boolean).map((g) => (
              <span key={g} className="mono" style={{ fontSize: 11, background: "var(--surface)", color: "var(--jade)", padding: "4px 10px", borderRadius: 999, border: "1px solid var(--hairline)" }}>{g}</span>
            ))}
            {statusLabel && (
              <span className="mono" style={{ fontSize: 11, color: STATUS_COLORS[series.seriesStatus], padding: "4px 10px", borderRadius: 999, border: `1px solid ${STATUS_COLORS[series.seriesStatus]}` }}>{statusLabel}</span>
            )}
          </div>
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, maxWidth: 480, marginBottom: 16 }}>{series.description}</p>

          {avgRating !== null && (
            <div className="flex items-center" style={{ gap: 6, marginBottom: 14 }}>
              <Star size={15} color="var(--accent)" fill="var(--accent)" />
              <span style={{ fontSize: 14, fontWeight: 700 }}>{avgRating.toFixed(1)}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>({ratings.length})</span>
            </div>
          )}

          <div className="flex items-center" style={{ gap: 10 }}>
            <button onClick={toggleBookmark} style={{ display: "flex", alignItems: "center", gap: 6, background: bookmarked ? "var(--accent)" : "var(--surface)", color: bookmarked ? "var(--ink)" : "var(--paper)", border: "1px solid var(--hairline)", padding: "9px 16px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              {bookmarked ? <BookmarkCheck size={15} /> : <Bookmark size={15} />} {bookmarked ? "Bookmarked" : "Bookmark"}
            </button>
            <button onClick={share} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface)", color: "var(--paper)", border: "1px solid var(--hairline)", padding: "9px 16px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              <Share2 size={15} /> {shared ? "Link copied!" : "Share"}
            </button>
          </div>
        </div>
      </div>

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, margin: "40px 0 8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Episodes</p>
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

      <section style={{ marginTop: 56 }}>
        <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.1em", display: "flex", alignItems: "center", gap: 6 }}>
          <MessageCircle size={13} /> Comments ({comments.length})
        </p>

        <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 18, marginBottom: 24 }}>
          <div className="flex items-center" style={{ gap: 4, marginBottom: 12 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setRating(rating === n ? 0 : n)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                <Star size={20} color="var(--accent)" fill={n <= rating ? "var(--accent)" : "none"} />
              </button>
            ))}
          </div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" style={inputStyle} />
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Share your thoughts…" style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} />
          <button onClick={submitComment} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Post comment</button>
        </div>

        {comments.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No comments yet — be the first to say something.</p>
        ) : (
          comments.map(c => (
            <div key={c.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--hairline)" }}>
              <div className="flex items-center" style={{ gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</span>
                {c.rating ? (
                  <span className="flex items-center" style={{ gap: 2 }}>
                    {Array.from({ length: c.rating }).map((_, i) => <Star key={i} size={11} color="var(--accent)" fill="var(--accent)" />)}
                  </span>
                ) : null}
                <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{timeAgo(c.createdAt)}</span>
              </div>
              <p style={{ fontSize: 14, color: "var(--paper)", lineHeight: 1.5 }}>{c.text}</p>
            </div>
          ))
        )}
      </section>
    </main>
  );
}

function Reader({ data, seriesId, chapterId, onOpenChapter, onBackToSeries }) {
  const containerRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [shared, setShared] = useState(false);
  const series = data.series.find(s => s.id === seriesId);
  const chapters = data.chapters.filter(c => c.seriesId === seriesId && c.status !== "draft").sort((a, b) => a.number - b.number);
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

  useEffect(() => {
    if (!chapter) return;
    recordHistory(seriesId, chapter.id, chapter.number);
    trackView("chapterViews", chapter.id);
  }, [chapter?.id]);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: chapter?.title, url }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(url); setShared(true); setTimeout(() => setShared(false), 2000); } catch {}
    }
  };

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
        <div className="flex items-center" style={{ gap: 14 }}>
          <button onClick={share} className="mono" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
            <Share2 size={14} /> {shared ? "Copied!" : ""}
          </button>
          <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>EP. {String(chapter.number).padStart(2, "0")}</span>
        </div>
      </div>

      <h2 className="display" style={{ textAlign: "center", fontSize: 22, margin: "18px 0 30px" }}>{chapter.title}</h2>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {chapter.pdfUrl ? (
          <PdfPages url={chapter.pdfUrl} />
        ) : chapter.pages.length === 0 ? (
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

function PdfPages({ url }) {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const pdfRef = useRef(null);
  const canvasRefs = useRef([]);

  // Load the PDF document itself
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setNumPages(0); canvasRefs.current = [];
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const pdf = await pdfjsLib.getDocument(url).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Couldn't load this PDF. Make sure the link is a direct, publicly accessible file link (not a viewer/share page).");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  // Once we know the page count and the canvas elements exist, render each page into its canvas
  useEffect(() => {
    if (!numPages || !pdfRef.current) return;
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) return;
        const page = await pdfRef.current.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = canvasRefs.current[i - 1];
        if (!canvas) continue;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })();
    return () => { cancelled = true; };
  }, [numPages]);

  if (error) return <p style={{ textAlign: "center", color: "var(--muted)", padding: "60px 24px" }}>{error}</p>;
  if (loading) return <p style={{ textAlign: "center", color: "var(--muted)", padding: "60px 24px" }}>Loading pages…</p>;

  return (
    <div>
      {Array.from({ length: numPages }).map((_, i) => (
        <canvas key={i} ref={(el) => (canvasRefs.current[i] = el)} style={{ width: "100%", display: "block" }} />
      ))}
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
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out, object = signed in
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("series");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  const login = async () => {
    setErr("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (e) {
      setErr("Wrong email or password.");
    }
  };

  if (user === undefined) {
    return <main style={{ padding: 80, textAlign: "center", color: "var(--muted)" }}>Checking access…</main>;
  }

  if (!user) {
    return (
      <main style={{ maxWidth: 360, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <Lock size={26} color="var(--accent)" style={{ marginBottom: 14 }} />
        <h1 className="display" style={{ fontSize: 24, marginBottom: 18 }}>Studio Access</h1>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inputStyle} autoCapitalize="none" />
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") login(); }}
          placeholder="Password" style={inputStyle} />
        {err && <p style={{ color: "var(--accent)", fontSize: 12, marginTop: 4, marginBottom: 8 }}>{err}</p>}
        <button onClick={login}
          style={{ marginTop: 6, width: "100%", background: "var(--accent)", color: "var(--ink)", border: "none", padding: "12px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
          Sign in
        </button>
        <button onClick={onBack} style={{ marginTop: 24, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>← Back to site</button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px 100px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 28 }}>
        <h1 className="display" style={{ fontSize: 30, margin: 0 }}>Studio</h1>
        <div className="flex items-center" style={{ gap: 10 }}>
          <button onClick={onBack} className="mono" style={{ background: "none", border: "1px solid var(--hairline)", color: "var(--paper)", padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 12 }}>View site</button>
          <button onClick={() => signOut(auth)} className="mono" style={{ background: "none", border: "1px solid var(--hairline)", color: "var(--muted)", padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      <div className="flex" style={{ gap: 8, marginBottom: 28, borderBottom: "1px solid var(--hairline)" }}>
        {["series", "chapters", "analytics", "settings"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "10px 4px", marginRight: 20,
            color: tab === t ? "var(--paper)" : "var(--muted)", borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: 700, fontSize: 14, textTransform: "capitalize"
          }}>{t}</button>
        ))}
      </div>

      {tab === "series" ? <SeriesAdmin data={data} persist={persist} />
        : tab === "chapters" ? <ChaptersAdmin data={data} persist={persist} />
        : tab === "analytics" ? <AnalyticsAdmin data={data} persist={persist} />
        : <SettingsAdmin data={data} persist={persist} />}
    </main>
  );
}

const inputStyle = {
  width: "100%", background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--paper)",
  padding: "11px 14px", borderRadius: 8, fontSize: 14, marginBottom: 12, fontFamily: "'Noto Sans KR', sans-serif"
};
const labelStyle = { fontSize: 12, color: "var(--muted)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.06em" };

function SettingsAdmin({ data, persist }) {
  const settings = data.settings || {};
  const [siteTitle, setSiteTitle] = useState(settings.siteTitle || "");
  const [tagline, setTagline] = useState(settings.tagline || "");
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || "");
  const [cloudinaryCloudName, setCloudinaryCloudName] = useState(settings.cloudinaryCloudName || "");
  const [cloudinaryUploadPreset, setCloudinaryUploadPreset] = useState(settings.cloudinaryUploadPreset || "");
  const [saved, setSaved] = useState(false);

  const save = () => {
    persist({ ...data, settings: { siteTitle: siteTitle.trim(), tagline: tagline.trim(), logoUrl: logoUrl.trim(), cloudinaryCloudName: cloudinaryCloudName.trim(), cloudinaryUploadPreset: cloudinaryUploadPreset.trim() } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <p style={{ fontWeight: 700, marginBottom: 14 }}>Site branding</p>
        <label style={labelStyle}>Logo image URL</label>
        <input style={inputStyle} value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." />
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -6, marginBottom: 12 }}>
          If set, this image replaces the "{siteTitle.trim() || "SCROLL."}" text logo in the top bar. Leave blank to keep the text logo.
        </p>
        {logoUrl.trim() && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Preview</label>
            <img src={logoUrl} alt="Logo preview" style={{ height: 34, maxWidth: 200, objectFit: "contain", display: "block" }}
                 onError={(e) => { e.target.style.display = "none"; }} />
          </div>
        )}
        <label style={labelStyle}>Site name (used if no logo image is set)</label>
        <input style={inputStyle} value={siteTitle} onChange={e => setSiteTitle(e.target.value)} placeholder="SCROLL." />
        <label style={labelStyle}>Tagline</label>
        <input style={inputStyle} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="vertical stories, one panel at a time" />
        <button onClick={save} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
          {saved ? "Saved ✓" : "Save settings"}
        </button>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>File uploads (Cloudinary)</p>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, lineHeight: 1.6 }}>
          To upload PNG/PDF files directly from your device instead of pasting URLs, create a free account at{" "}
          <span style={{ color: "var(--jade)" }}>cloudinary.com</span> (no credit card needed), then in Settings → Upload
          create an "unsigned" upload preset. Paste your cloud name and preset name below.
        </p>
        <label style={labelStyle}>Cloudinary cloud name</label>
        <input style={inputStyle} value={cloudinaryCloudName} onChange={e => setCloudinaryCloudName(e.target.value)} placeholder="e.g. dabc123xy" />
        <label style={labelStyle}>Unsigned upload preset name</label>
        <input style={inputStyle} value={cloudinaryUploadPreset} onChange={e => setCloudinaryUploadPreset(e.target.value)} placeholder="e.g. scroll_uploads" />
        <button onClick={save} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
          {saved ? "Saved ✓" : "Save settings"}
        </button>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 20 }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>Backup</p>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, lineHeight: 1.6 }}>
          Download a full copy of your series, episodes, comments, and settings as a JSON file — useful before making big changes.
        </p>
        <button onClick={() => downloadBackup(data)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid var(--hairline)", color: "var(--paper)", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
          <Download size={14} /> Download backup (.json)
        </button>
      </div>
    </div>
  );
}

function SeriesAdmin({ data, persist }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [cover, setCover] = useState("");
  const [genre, setGenre] = useState("");
  const [status, setStatus] = useState("published");
  const [seriesStatus, setSeriesStatus] = useState("ongoing");
  const [editingId, setEditingId] = useState(null);

  const resetForm = () => { setTitle(""); setDesc(""); setCover(""); setGenre(""); setStatus("published"); setSeriesStatus("ongoing"); setEditingId(null); };

  const startEdit = (s) => {
    setEditingId(s.id);
    setTitle(s.title); setDesc(s.description || ""); setCover(s.coverUrl || ""); setGenre(s.genre || ""); setStatus(s.status || "published"); setSeriesStatus(s.seriesStatus || "ongoing");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveSeries = () => {
    if (!title.trim()) return;
    if (editingId) {
      const next = { ...data, series: data.series.map(s => s.id === editingId ? { ...s, title: title.trim(), description: desc.trim(), coverUrl: cover.trim(), genre: genre.trim(), status, seriesStatus } : s) };
      persist(next);
    } else {
      const next = { ...data, series: [...data.series, { id: uid("series"), title: title.trim(), description: desc.trim(), coverUrl: cover.trim(), genre: genre.trim(), status, seriesStatus }] };
      persist(next);
    }
    resetForm();
  };

  const removeSeries = (id, title) => {
    if (!window.confirm(`Delete "${title}" and all its episodes? This can't be undone.`)) return;
    const next = { series: data.series.filter(s => s.id !== id), chapters: data.chapters.filter(c => c.seriesId !== id) };
    persist(next);
    if (editingId === id) resetForm();
  };

  const moveSeries = (index, dir) => {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= data.series.length) return;
    const arr = [...data.series];
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    persist({ ...data, series: arr });
  };

  return (
    <div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 20, marginBottom: 28 }}>
        <p style={{ fontWeight: 700, marginBottom: 14 }}>{editingId ? "Edit series" : "Add a series"}</p>
        <label style={labelStyle}>Title</label>
        <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Moonlit Heirs" />
        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="One or two sentences readers see on the series page." />
        <label style={labelStyle}>Cover image URL</label>
        <UploadButton settings={data.settings} accept="image/*" label="Upload cover image" onUploaded={(url) => setCover(url)} />
        <input style={inputStyle} value={cover} onChange={e => setCover(e.target.value)} placeholder="https://..." />
        <label style={labelStyle}>Genre tags (comma-separated)</label>
        <input style={inputStyle} value={genre} onChange={e => setGenre(e.target.value)} placeholder="Fantasy, Romance, Drama" />
        <label style={labelStyle}>Reading status</label>
        <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
          {["ongoing", "completed", "hiatus"].map(st => (
            <button key={st} type="button" onClick={() => setSeriesStatus(st)} style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid var(--hairline)", cursor: "pointer", fontSize: 13, fontWeight: 700, textTransform: "capitalize",
              background: seriesStatus === st ? "var(--accent)" : "transparent", color: seriesStatus === st ? "var(--ink)" : "var(--paper)"
            }}>{st}</button>
          ))}
        </div>
        <label style={labelStyle}>Visibility</label>
        <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={() => setStatus("published")} style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid var(--hairline)", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: status === "published" ? "var(--accent)" : "transparent", color: status === "published" ? "var(--ink)" : "var(--paper)"
          }}>Published</button>
          <button type="button" onClick={() => setStatus("draft")} style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid var(--hairline)", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: status === "draft" ? "var(--accent)" : "transparent", color: status === "draft" ? "var(--ink)" : "var(--paper)"
          }}>Draft (hidden)</button>
        </div>
        <div className="flex" style={{ gap: 10 }}>
          <button onClick={saveSeries} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={16} /> {editingId ? "Save changes" : "Add series"}
          </button>
          {editingId && (
            <button onClick={resetForm} style={{ background: "none", color: "var(--muted)", border: "1px solid var(--hairline)", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4, textTransform: "uppercase" }}>Existing series ({data.series.length})</p>
      <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>Use the arrows to change the order series appear in on the homepage.</p>
      {data.series.map((s, i) => (
        <div key={s.id} className="flex items-center justify-between" style={{ padding: "12px 0", borderBottom: "1px solid var(--hairline)" }}>
          <div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <p style={{ fontWeight: 700, fontSize: 14 }}>{s.title}</p>
              {s.status === "draft" && (
                <span className="mono" style={{ fontSize: 10, color: "var(--muted)", border: "1px solid var(--hairline)", borderRadius: 999, padding: "2px 8px" }}>DRAFT</span>
              )}
              {STATUS_LABELS[s.seriesStatus] && (
                <span className="mono" style={{ fontSize: 10, color: STATUS_COLORS[s.seriesStatus], border: `1px solid ${STATUS_COLORS[s.seriesStatus]}`, borderRadius: 999, padding: "2px 8px" }}>{STATUS_LABELS[s.seriesStatus]}</span>
              )}
            </div>
            <p className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{data.chapters.filter(c => c.seriesId === s.id).length} episodes</p>
          </div>
          <div className="flex items-center" style={{ gap: 10 }}>
            <button onClick={() => moveSeries(i, -1)} disabled={i === 0} style={{ background: "none", border: "none", color: i === 0 ? "var(--hairline)" : "var(--muted)", cursor: i === 0 ? "default" : "pointer" }}><ArrowUp size={15} /></button>
            <button onClick={() => moveSeries(i, 1)} disabled={i === data.series.length - 1} style={{ background: "none", border: "none", color: i === data.series.length - 1 ? "var(--hairline)" : "var(--muted)", cursor: i === data.series.length - 1 ? "default" : "pointer" }}><ArrowDown size={15} /></button>
            <button onClick={() => startEdit(s)} style={{ background: "none", border: "none", color: "var(--jade)", cursor: "pointer" }}><Pencil size={16} /></button>
            <button onClick={() => removeSeries(s.id, s.title)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><Trash2 size={16} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: "16px 20px", minWidth: 110, flex: 1 }}>
      <p className="display" style={{ fontSize: 26, margin: 0 }}>{value}</p>
      <p className="mono" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginTop: 4 }}>{label}</p>
    </div>
  );
}

function AnalyticsAdmin({ data, persist }) {
  const analytics = data.analytics || {};
  const seriesViews = analytics.seriesViews || {};
  const chapterViews = analytics.chapterViews || {};
  const comments = (data.comments || []).slice().sort((a, b) => b.createdAt - a.createdAt);

  const totalViews = Object.values(seriesViews).reduce((a, b) => a + b, 0) + Object.values(chapterViews).reduce((a, b) => a + b, 0);

  const topSeries = Object.entries(seriesViews)
    .map(([id, views]) => ({ series: data.series.find(s => s.id === id), views }))
    .filter(x => x.series)
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  const topChapters = Object.entries(chapterViews)
    .map(([id, views]) => {
      const chapter = data.chapters.find(c => c.id === id);
      return chapter ? { chapter, series: data.series.find(s => s.id === chapter.seriesId), views } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  const deleteComment = (id) => {
    if (!window.confirm("Delete this comment?")) return;
    persist({ ...data, comments: (data.comments || []).filter(c => c.id !== id) });
  };

  return (
    <div>
      <div className="flex" style={{ gap: 14, marginBottom: 32, flexWrap: "wrap" }}>
        <StatCard label="Total views" value={totalViews} />
        <StatCard label="Series" value={data.series.length} />
        <StatCard label="Episodes" value={data.chapters.length} />
        <StatCard label="Comments" value={comments.length} />
      </div>

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12, textTransform: "uppercase" }}>Top series by views</p>
      {topSeries.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 28 }}>No views recorded yet.</p>
      ) : (
        <div style={{ marginBottom: 28 }}>
          {topSeries.map(({ series, views }) => (
            <div key={series.id} className="flex items-center justify-between" style={{ padding: "10px 0", borderBottom: "1px solid var(--hairline)" }}>
              <span style={{ fontSize: 14 }}>{series.title}</span>
              <span className="mono flex items-center" style={{ fontSize: 12, color: "var(--muted)", gap: 5 }}><Eye size={13} /> {views}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12, textTransform: "uppercase" }}>Top episodes by views</p>
      {topChapters.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 28 }}>No views recorded yet.</p>
      ) : (
        <div style={{ marginBottom: 28 }}>
          {topChapters.map(({ chapter, series, views }) => (
            <div key={chapter.id} className="flex items-center justify-between" style={{ padding: "10px 0", borderBottom: "1px solid var(--hairline)" }}>
              <span style={{ fontSize: 14 }}>{series?.title} — EP.{String(chapter.number).padStart(2, "0")}</span>
              <span className="mono flex items-center" style={{ fontSize: 12, color: "var(--muted)", gap: 5 }}><Eye size={13} /> {views}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12, textTransform: "uppercase" }}>Recent comments</p>
      {comments.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>No comments yet.</p>
      ) : comments.slice(0, 25).map(c => {
        const series = data.series.find(s => s.id === c.seriesId);
        return (
          <div key={c.id} className="flex items-center justify-between" style={{ padding: "10px 0", borderBottom: "1px solid var(--hairline)", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700 }}>{c.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>on {series?.title || "Unknown"}</span></p>
              <p style={{ fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.text}</p>
            </div>
            <button onClick={() => deleteComment(c.id)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", flexShrink: 0 }}><Trash2 size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}

function ChaptersAdmin({ data, persist }) {
  const [seriesId, setSeriesId] = useState(data.series[0]?.id || "");
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [pagesText, setPagesText] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [contentType, setContentType] = useState("images"); // "images" | "pdf"
  const [status, setStatus] = useState("published");
  const [editingId, setEditingId] = useState(null);

  if (data.series.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 14 }}>Add a series first, then come back to add episodes.</p>;
  }

  const resetForm = () => {
    setNumber(""); setTitle(""); setDateStr(""); setPagesText(""); setPdfUrl(""); setContentType("images"); setStatus("published"); setEditingId(null);
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setSeriesId(c.seriesId);
    setNumber(String(c.number));
    setTitle(c.title);
    setDateStr(c.date || "");
    setStatus(c.status || "published");
    if (c.pdfUrl) { setContentType("pdf"); setPdfUrl(c.pdfUrl); setPagesText(""); }
    else { setContentType("images"); setPagesText((c.pages || []).join("\n")); setPdfUrl(""); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveChapter = () => {
    if (!seriesId || !number.trim() || !title.trim()) return;
    const pages = contentType === "images" ? pagesText.split("\n").map(l => l.trim()).filter(Boolean) : [];
    const chapterPdfUrl = contentType === "pdf" ? pdfUrl.trim() : "";
    if (editingId) {
      const next = { ...data, chapters: data.chapters.map(c => c.id === editingId
        ? { ...c, seriesId, number: Number(number), title: title.trim(), date: dateStr.trim(), pages, pdfUrl: chapterPdfUrl, status }
        : c) };
      persist(next);
    } else {
      const next = { ...data, chapters: [...data.chapters, { id: uid("ch"), seriesId, number: Number(number), title: title.trim(), date: dateStr.trim(), pages, pdfUrl: chapterPdfUrl, status, createdAt: Date.now() }] };
      persist(next);
    }
    resetForm();
  };

  const removeChapter = (id, title) => {
    if (!window.confirm(`Delete episode "${title}"? This can't be undone.`)) return;
    persist({ ...data, chapters: data.chapters.filter(c => c.id !== id) });
    if (editingId === id) resetForm();
  };

  const chaptersForSeries = data.chapters.filter(c => c.seriesId === seriesId).sort((a, b) => a.number - b.number);

  return (
    <div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: 20, marginBottom: 28 }}>
        <p style={{ fontWeight: 700, marginBottom: 14 }}>{editingId ? "Edit episode" : "Add an episode"}</p>
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

        <label style={labelStyle}>Content type</label>
        <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={() => setContentType("images")} style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid var(--hairline)", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: contentType === "images" ? "var(--accent)" : "transparent", color: contentType === "images" ? "var(--ink)" : "var(--paper)"
          }}>Page images</button>
          <button type="button" onClick={() => setContentType("pdf")} style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid var(--hairline)", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: contentType === "pdf" ? "var(--accent)" : "transparent", color: contentType === "pdf" ? "var(--ink)" : "var(--paper)"
          }}>PDF file</button>
        </div>

        {contentType === "images" ? (
          <>
            <label style={labelStyle}>Page image URLs — one per line, in reading order</label>
            <UploadButton settings={data.settings} accept="image/*" multiple label="Upload page images" onUploaded={(urls) => {
              setPagesText(prev => (prev ? prev + "\n" : "") + urls.join("\n"));
            }} />
            <textarea style={{ ...inputStyle, minHeight: 110, resize: "vertical", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
              value={pagesText} onChange={e => setPagesText(e.target.value)} placeholder={"https://example.com/page1.jpg\nhttps://example.com/page2.jpg"} />
          </>
        ) : (
          <>
            <label style={labelStyle}>PDF file URL</label>
            <UploadButton settings={data.settings} accept="application/pdf" label="Upload PDF" onUploaded={(url) => setPdfUrl(url)} />
            <input style={{ ...inputStyle, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
              value={pdfUrl} onChange={e => setPdfUrl(e.target.value)} placeholder="https://raw.githubusercontent.com/you/repo/main/chapter1.pdf" />
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -6, marginBottom: 12 }}>
              Needs to be a direct file link (ends in .pdf) that's publicly accessible — a public GitHub repo works well for this.
            </p>
          </>
        )}

        <label style={labelStyle}>Visibility</label>
        <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={() => setStatus("published")} style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid var(--hairline)", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: status === "published" ? "var(--accent)" : "transparent", color: status === "published" ? "var(--ink)" : "var(--paper)"
          }}>Published</button>
          <button type="button" onClick={() => setStatus("draft")} style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid var(--hairline)", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: status === "draft" ? "var(--accent)" : "transparent", color: status === "draft" ? "var(--ink)" : "var(--paper)"
          }}>Draft (hidden)</button>
        </div>

        <div className="flex" style={{ gap: 10 }}>
          <button onClick={saveChapter} style={{ background: "var(--accent)", color: "var(--ink)", border: "none", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={16} /> {editingId ? "Save changes" : "Add episode"}
          </button>
          {editingId && (
            <button onClick={resetForm} style={{ background: "none", color: "var(--muted)", border: "1px solid var(--hairline)", padding: "10px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10, textTransform: "uppercase" }}>Episodes in this series ({chaptersForSeries.length})</p>
      {chaptersForSeries.map(c => (
        <div key={c.id} className="flex items-center justify-between" style={{ padding: "12px 0", borderBottom: "1px solid var(--hairline)" }}>
          <div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <p style={{ fontWeight: 700, fontSize: 14 }}>EP.{String(c.number).padStart(2, "0")} — {c.title}</p>
              {c.status === "draft" && (
                <span className="mono" style={{ fontSize: 10, color: "var(--muted)", border: "1px solid var(--hairline)", borderRadius: 999, padding: "2px 8px" }}>DRAFT</span>
              )}
            </div>
            <p className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{c.pdfUrl ? "PDF chapter" : `${c.pages.length} pages`}</p>
          </div>
          <div className="flex items-center" style={{ gap: 14 }}>
            <button onClick={() => startEdit(c)} style={{ background: "none", border: "none", color: "var(--jade)", cursor: "pointer" }}><Pencil size={16} /></button>
            <button onClick={() => removeChapter(c.id, c.title)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><Trash2 size={16} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
