import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Play, Pause, Search, Settings, User, LogOut, Plus, KeyRound, Clapperboard, Maximize, Gauge, SkipForward, Cog, Loader2, Subtitles } from "lucide-react";
import { api, clearSession, getProfile, setSession } from "./api";
import "./styles.css";

function fmt(seconds = 0) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itemType(item) {
  const type = item?.type || item?.contentType || item?.kind || item?.catalogType;
  if (["series", "show", "tv"].includes(type)) return "series";
  return type || (item?.videos?.length ? "series" : "movie");
}

function episodeLabel(ep) {
  const s = ep.season ?? ep.seasonNumber ?? 1;
  const e = ep.episode ?? ep.episodeNumber ?? ep.number ?? 1;
  return `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;
}

function playableFrom(meta, target, fallbackType) {
  const type = target.type || fallbackType || itemType(meta);
  return {
    ...meta,
    ...target,
    id: target.id || meta.id,
    type,
    name: target.title || target.name || meta.name,
    season: target.season ?? target.seasonNumber,
    episode: target.episode ?? target.episodeNumber ?? target.number,
    poster: target.poster || target.thumbnail || meta.poster,
    background: target.background || target.backdrop || meta.background || meta.backdrop,
  };
}

function AuthScreen({ onLogin }) {
  const [bootstrap, setBootstrap] = useState(null);
  const [mode, setMode] = useState("admin");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [guestCode, setGuestCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { api("/bootstrap").then(setBootstrap).catch((err) => setError(err.message)); }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      if (mode === "guest") {
        const data = await api("/auth/guest", { method: "POST", body: JSON.stringify({ code: guestCode }) });
        setSession(data.token, { role: "guest", ...data.guest });
        onLogin();
        return;
      }
      const path = bootstrap?.needs_admin_registration ? "/auth/register-admin" : "/auth/login";
      const data = await api(path, { method: "POST", body: JSON.stringify({ username, password }) });
      setSession(data.token, data.user);
      onLogin();
    } catch (err) { setError(err.message); }
  }

  return <main className="auth-page"><section className="auth-card glass">
    <div className="brand"><Clapperboard /> <span>Player</span></div>
    <h1>{mode === "guest" ? "Logowanie gościa" : bootstrap?.needs_admin_registration ? "Pierwsza konfiguracja" : "Logowanie admina"}</h1>
    <p>{mode === "guest" ? "Wpisz 6-cyfrowy kod wygenerowany w panelu admina." : bootstrap?.needs_admin_registration ? "Utwórz pierwsze konto administratora. Później rejestracja będzie zablokowana." : "Zaloguj się do panelu i biblioteki."}</p>
    <form onSubmit={submit}>{mode !== "guest" ? <>
      <label>Nazwa użytkownika</label><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      <label>Hasło</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
    </> : <><label>Kod gościa</label><input value={guestCode} onChange={(e) => setGuestCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" /></>}
      {error && <div className="error">{error}</div>}
      <button className="primary" type="submit">{mode === "guest" ? "Wejdź jako gość" : bootstrap?.needs_admin_registration ? "Utwórz admina" : "Zaloguj"}</button>
    </form>
    <button className="link" onClick={() => setMode(mode === "guest" ? "admin" : "guest")}>{mode === "guest" ? "Wróć do logowania admina" : "Zaloguj się jako gość"}</button>
  </section></main>;
}

function TopBar({ profile, onLogout, onSearch, onSearchPreview, searchPreview, onOpenItem, onAdmin }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const id = setTimeout(() => onSearchPreview(query), 1000);
    return () => clearTimeout(id);
  }, [q]);

  function submit(e) {
    e.preventDefault();
    if (q.trim()) { setFocused(false); onSearch(q.trim()); }
  }

  const previewItems = (searchPreview?.results || []).slice(0, 8);
  return <header className="topbar">
    <div className="brand"><Clapperboard /> <span>Player</span></div>
    <div className="search-wrap">
      <form className="search" onSubmit={submit}><Search size={18} /><input placeholder="Szukaj filmu lub serialu..." value={q} onFocus={() => setFocused(true)} onChange={(e) => setQ(e.target.value)} /></form>
      {focused && q.trim().length >= 2 && <div className="search-preview glass">
        {searchPreview?.loading && <div className="preview-loading"><Loader2 className="spin" /> Szukam...</div>}
        {!searchPreview?.loading && previewItems.length === 0 && <div className="preview-empty">Brak wyników</div>}
        {previewItems.map((item) => <button key={`${item.type}-${item.id}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFocused(false); onOpenItem(item); }}>
          {item.poster ? <img src={item.poster} alt="" /> : <div className="mini-poster" />}
          <span><strong>{item.name}</strong><small>{item.type === "series" ? "Serial" : "Film"}</small></span>
        </button>)}
        {previewItems.length > 0 && <button className="all-results" onMouseDown={(e) => e.preventDefault()} onClick={() => { setFocused(false); onSearch(q.trim()); }}>Pokaż wszystkie wyniki</button>}
      </div>}
    </div>
    {profile?.role === "guest" && <div className="limit">Limit: {profile.remaining ?? "?"}/{profile.limit ?? "?"}</div>}
    <div className="menu-wrap"><button className="icon" onClick={() => setOpen(!open)}><Settings /></button>
      {open && <div className="menu glass"><div><User size={16} /> {profile?.username || profile?.display_name || "Konto"}</div>{profile?.role === "admin" && <button onClick={onAdmin}><KeyRound size={16} /> Panel admina</button>}<button onClick={onLogout}><LogOut size={16} /> Wyloguj</button></div>}
    </div>
  </header>;
}

function Hero({ items, hasLibraries, onOpen }) {
  const [index, setIndex] = useState(0);
  const list = (items || []).slice(0, 10);
  useEffect(() => {
    if (list.length <= 1) return;
    const id = setInterval(() => setIndex((v) => (v + 1) % list.length), 15000);
    return () => clearInterval(id);
  }, [list.length]);
  const item = list[index];
  if (!item) return <section className="hero empty"><h1>{hasLibraries ? "Brak tytułów w wybranej bibliotece" : "Brak propozycji"}</h1><p>{hasLibraries ? "Wybierz inną bibliotekę proponowaną w panelu admina albo sprawdź addon." : "Dodaj addon w panelu admina, aby biblioteka mogła wyświetlić filmy i seriale."}</p></section>;
  const bg = item.background || item.backdrop || item.poster;
  return <section className="hero" style={{ backgroundImage: bg ? `linear-gradient(90deg, #0b0b0f 0%, rgba(11,11,15,.72) 45%, rgba(11,11,15,.18)), url(${bg})` : undefined }}>
    <div className="hero-copy"><div className="eyebrow">Proponowane</div><h1>{item.name}</h1><p>{item.description || "Materiał z biblioteki addonu."}</p><button className="primary" onClick={() => onOpen(item)}><Play size={18} /> Otwórz</button></div>
    <div className="hero-dots">{list.map((_, i) => <button key={i} className={i === index ? "active" : ""} onClick={() => setIndex(i)} />)}</div>
  </section>;
}

function Row({ library, onOpen }) {
  return <section className="row"><h2>{library.catalog?.name || library.catalog?.id}</h2>{library.error && <div className="error small">{library.error}</div>}<div className="cards">{(library.items || []).map((item) => <button className="poster" key={`${library.key || library.catalog?.id}-${item.id}`} onClick={() => onOpen({ ...item, type: library.catalog?.type || itemType(item) })}>{item.poster ? <img src={item.poster} alt="" /> : <div className="poster-fallback">{item.name}</div>}<strong>{item.name}</strong></button>)}</div></section>;
}

function ResultsPage({ query, results, onBack, onOpen }) {
  const movies = results?.movies || [];
  const series = results?.series || [];
  return <main className="results-page"><button className="link back" onClick={onBack}>← Wróć</button><h1>Wyniki dla „{query}”</h1>
    <section className="result-section"><h2>Filmy</h2>{movies.length ? <div className="result-grid">{movies.map((item) => <button className="poster" key={`movie-${item.id}`} onClick={() => onOpen({ ...item, type: "movie" })}>{item.poster ? <img src={item.poster} alt="" /> : <div className="poster-fallback">{item.name}</div>}<strong>{item.name}</strong></button>)}</div> : <p>Brak filmów.</p>}</section>
    <section className="result-section"><h2>Seriale</h2>{series.length ? <div className="result-grid">{series.map((item) => <button className="poster" key={`series-${item.id}`} onClick={() => onOpen({ ...item, type: "series" })}>{item.poster ? <img src={item.poster} alt="" /> : <div className="poster-fallback">{item.name}</div>}<strong>{item.name}</strong></button>)}</div> : <p>Brak seriali.</p>}</section>
  </main>;
}

function Details({ item, history, onBack, onPlay }) {
  const [meta, setMeta] = useState(item);
  const type = itemType(meta);

  useEffect(() => {
    let active = true;
    setMeta(item);
    api(`/meta/${item.type || itemType(item)}/${encodeURIComponent(item.id)}`).then((data) => active && setMeta({ ...item, ...data.meta, type: item.type || itemType(data.meta) })).catch(() => {});
    return () => { active = false; };
  }, [item.id]);

  const videos = meta.videos || [];
  const grouped = videos.reduce((acc, ep) => { const s = ep.season ?? ep.seasonNumber ?? 1; acc[s] ||= []; acc[s].push(ep); return acc; }, {});
  const last = history.find((h) => h.content_type === "series" && (videos.some((v) => v.id === h.content_id) || h.title === meta.name));
  const nextEpisode = useMemo(() => {
    if (!videos.length) return null;
    const sorted = [...videos].sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? a.number ?? 1) - (b.episode ?? b.number ?? 1));
    if (!last) return sorted[0];
    const idx = sorted.findIndex((ep) => ep.id === last.content_id);
    if (idx < 0) return sorted[0];
    const almostFinished = last.duration_seconds > 0 && last.duration_seconds - last.position_seconds <= 300;
    return almostFinished ? sorted[idx + 1] || sorted[idx] : sorted[idx];
  }, [videos, last]);

  function playTarget(target) {
    onPlay(playableFrom(meta, target, target.type || type), []);
  }

  const bg = meta.background || meta.backdrop || meta.poster;
  const primaryTarget = nextEpisode ? { ...nextEpisode, type: "series" } : { ...meta, type };
  const primaryLabel = nextEpisode ? `Odtwarzaj ${episodeLabel(nextEpisode)}` : "Odtwarzaj";
  return <main className="details" style={{ backgroundImage: bg ? `linear-gradient(180deg, rgba(11,11,15,.35), #0b0b0f 52%), url(${bg})` : undefined }}>
    <button className="link back" onClick={onBack}>← Wróć</button>
    <section className="details-grid">{meta.poster && <img className="detail-poster" src={meta.poster} alt="" />}<div><h1>{meta.name}</h1><p>{meta.description || "Brak opisu w addonie."}</p><button className="primary" onClick={() => playTarget(primaryTarget)}><Play size={18} /> {primaryLabel}</button></div></section>
    {videos.length > 0 && <section className="episodes"><h2>Sezony</h2>{Object.entries(grouped).map(([season, eps]) => <div className="season" key={season}><h3>Sezon {season}</h3>{eps.map((ep) => <div className="episode-row" key={ep.id}><img src={ep.thumbnail || ep.poster || meta.poster} alt="" /><div><span>{episodeLabel(ep)}</span><strong>{ep.title || "Odcinek"}</strong><p>{ep.overview || ep.description || "Brak opisu odcinka."}</p></div><button className="episode-play" onClick={() => playTarget({ ...ep, type: "series" })}><Play /></button></div>)}</div>)}</section>}
  </main>;
}

function Player({ item, initialStreams, profile, onClose, onLimitUpdate }) {
  const videoRef = useRef(null);
  const hideRef = useRef(null);
  const [streams, setStreams] = useState(initialStreams || []);
  const [streamIndex, setStreamIndex] = useState(0);
  const [subtitles, setSubtitles] = useState([]);
  const [subtitleIndex, setSubtitleIndex] = useState(-1);
  const [notice, setNotice] = useState("");
  const [visible, setVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [retryCountdown, setRetryCountdown] = useState(null);
  const [finalNoSources, setFinalNoSources] = useState(false);
  const stream = streams[streamIndex];

  function showControls() { setVisible(true); clearTimeout(hideRef.current); hideRef.current = setTimeout(() => setVisible(false), 5000); }
  useEffect(() => { showControls(); return () => clearTimeout(hideRef.current); }, []);

  async function fetchStreamsOnce(active) {
    const data = await api(`/streams/${item.type || "movie"}/${encodeURIComponent(item.id)}`);
    if (!active()) return [];
    const nextStreams = data.streams || [];
    setStreams(nextStreams);
    setStreamIndex(0);
    return nextStreams;
  }

  useEffect(() => {
    let active = true;
    const isActive = () => active;
    setStreams([]);
    setStreamIndex(0);
    setSubtitles([]);
    setSubtitleIndex(-1);
    setLoading(true);
    setRetryCountdown(null);
    setFinalNoSources(false);
    setNotice("");

    async function runStreamSearch() {
      try {
        const first = await fetchStreamsOnce(isActive);
        if (!isActive() || first.length > 0) return;

        for (let remaining = 60; remaining > 0; remaining -= 1) {
          if (!isActive()) return;
          setRetryCountdown(remaining);
          await sleep(1000);
        }
        if (!isActive()) return;
        setRetryCountdown(0);
        setLoading(true);

        const second = await fetchStreamsOnce(isActive);
        if (!isActive()) return;
        if (second.length === 0) setFinalNoSources(true);
      } catch {
        if (isActive()) setFinalNoSources(true);
      } finally {
        if (isActive()) {
          setLoading(false);
          setRetryCountdown(null);
        }
      }
    }

    runStreamSearch();

    api(`/subtitles/${item.type || "movie"}/${encodeURIComponent(item.id)}`)
      .then((data) => active && setSubtitles(data.subtitles || []))
      .catch(() => {});

    api("/playback/start", { method: "POST", body: JSON.stringify({ content_type: item.type || "movie", content_id: item.id, title: item.name, season: item.season, episode: item.episode }) }).then((data) => {
      if (profile?.role === "guest" && data.remaining !== null) { setNotice(`Pozostało ci ${data.remaining} z ${profile.limit} limitu odtworzonych filmów`); onLimitUpdate?.(data.remaining); setTimeout(() => setNotice(""), 4500); }
    }).catch((err) => setNotice(err.message));

    return () => { active = false; };
  }, [item.id, item.type]);

  useEffect(() => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    for (let i = 0; i < tracks.length; i += 1) tracks[i].mode = i === subtitleIndex ? "showing" : "disabled";
  }, [subtitleIndex, subtitles.length]);

  useEffect(() => {
    const id = setInterval(() => {
      const v = videoRef.current;
      if (v && v.duration) api("/playback/progress", { method: "POST", body: JSON.stringify({ content_type: item.type || "movie", content_id: item.id, title: item.name, season: item.season, episode: item.episode, position_seconds: Math.floor(v.currentTime), duration_seconds: Math.floor(v.duration) }) }).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [item.id, item.type]);

  function toggle() { const v = videoRef.current; if (!v || !stream?.url) return; v.paused ? v.play() : v.pause(); }
  function seek(e) { const v = videoRef.current; if (!v || !duration) return; v.currentTime = Number(e.target.value); setTime(v.currentTime); }
  function fullscreen() { const shell = videoRef.current?.parentElement; shell?.requestFullscreen?.(); }

  const statusText = retryCountdown !== null
    ? `Nie znaleziono źródeł. Ponawiam wyszukiwanie za ${retryCountdown}s...`
    : finalNoSources
      ? "Brak źródeł do tego tytułu"
      : "Szukam źródeł...";

  return <main className="player-page"><button className="link back" onClick={onClose}>← Zamknij odtwarzacz</button><h1>{item.name}</h1>{notice && <div className="toast">{notice}</div>}
    <div className={`player-shell ${visible ? "controls-visible" : "controls-hidden"}`} onMouseMove={showControls} onClick={showControls} onTouchStart={showControls}>
      <video key={`${item.type}-${item.id}-${stream?.url || "empty"}`} ref={videoRef} src={stream?.url || undefined} controls={false} poster={item.background || item.poster} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onWaiting={() => setLoading(true)} onCanPlay={() => setLoading(false)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime || 0)}>
        {subtitles.map((sub, i) => <track key={`${sub.url || sub.file}-${i}`} kind="subtitles" src={sub.url || sub.file} srcLang={sub.lang || sub.language || "pl"} label={sub.name || sub.lang || sub.language || `Napisy ${i + 1}`} />)}
      </video>
      {(loading || !stream?.url || retryCountdown !== null || finalNoSources) && <div className="loading-overlay"><Loader2 className={finalNoSources ? "" : "spin"} /><span>{statusText}</span></div>}
      <div className="player-controls glass"><div className="timeline-row"><span>{fmt(time)}</span><input className="timeline" type="range" min="0" max={duration || 0} step="1" value={time} onChange={seek} /><span>{fmt(duration)}</span></div><div className="controls-row"><button onClick={toggle}>{playing ? <Pause /> : <Play />}</button><button title="Poprzedni odcinek"><SkipForward className="flip" /></button><button title="Następny odcinek"><SkipForward /></button><label className="compact-select"><Cog size={18} /><select value={streamIndex} onChange={(e) => setStreamIndex(Number(e.target.value))}>{streams.map((s, i) => <option key={i} value={i}>{s.name || s.title || s.addon || `Stream ${i + 1}`}</option>)}</select></label><label className="compact-select"><Subtitles size={18} /><select value={subtitleIndex} onChange={(e) => setSubtitleIndex(Number(e.target.value))}><option value="-1">Napisy wył.</option>{subtitles.map((s, i) => <option key={i} value={i}>{s.name || s.lang || s.language || `Napisy ${i + 1}`}</option>)}</select></label><label className="speed"><Gauge size={16} /><select onChange={(e) => { if (videoRef.current) videoRef.current.playbackRate = Number(e.target.value); }}><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></label><button title="Pomiń intro" className="intro">Pomiń intro</button><button onClick={fullscreen}><Maximize /></button></div></div>
    </div>
  </main>;
}

function AdminPanel({ onClose, libraries, settings, onSettingsSaved }) {
  const [addons, setAddons] = useState([]), [guests, setGuests] = useState([]), [logs, setLogs] = useState([]);
  const [url, setUrl] = useState(""), [guestName, setGuestName] = useState("Gość"), [limit, setLimit] = useState(10), [newCode, setNewCode] = useState(""), [error, setError] = useState("");
  const [featured, setFeatured] = useState(settings?.featured_catalog_key || "");
  async function load() { setAddons((await api("/addons")).addons || []); setGuests((await api("/admin/guests")).guests || []); setLogs((await api("/admin/logs/searches")).logs || []); }
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);
  async function installAddon(e) { e.preventDefault(); setError(""); try { await api("/admin/addons", { method: "POST", body: JSON.stringify({ url }) }); setUrl(""); await load(); onSettingsSaved?.(); } catch (err) { setError(err.message); } }
  async function createGuest(e) { e.preventDefault(); const data = await api("/admin/guests", { method: "POST", body: JSON.stringify({ display_name: guestName, play_limit: Number(limit) }) }); setNewCode(data.code); await load(); }
  async function saveSettings(e) { e.preventDefault(); await api("/admin/settings", { method: "PUT", body: JSON.stringify({ featured_catalog_key: featured }) }); onSettingsSaved?.(); }
  return <main className="admin"><button className="link back" onClick={onClose}>← Wróć</button><h1>Panel admina</h1>{error && <div className="error">{error}</div>}<section className="admin-grid">
    <div className="glass panel"><h2><Settings /> Ustawienia</h2><form onSubmit={saveSettings}><label>Biblioteka proponowana</label><select value={featured} onChange={(e) => setFeatured(e.target.value)}><option value="">Automatycznie / pierwsza dostępna</option>{libraries.map((l) => <option key={l.key} value={l.key}>{l.addon} — {l.catalog?.name || l.catalog?.id}</option>)}</select><button className="primary">Zapisz ustawienia</button></form></div>
    <div className="glass panel"><h2><Plus /> Addony</h2><form onSubmit={installAddon}><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://adres-addonu/" /><button className="primary">Dodaj addon</button></form>{addons.map((a) => <p key={a.id}><strong>{a.name}</strong><br/><span>{a.url}</span></p>)}</div>
    <div className="glass panel"><h2><KeyRound /> Goście</h2><form onSubmit={createGuest}><input value={guestName} onChange={(e) => setGuestName(e.target.value)} /><input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} /><button className="primary">Wygeneruj kod</button></form>{newCode && <div className="code">Nowy kod: {newCode}</div>}{guests.map((g) => <p key={g.id}>{g.display_name}: {g.remaining}/{g.limit} • {g.active ? "aktywny" : "zatrzymany"}</p>)}</div>
    <div className="glass panel"><h2>Wyszukiwania</h2>{logs.map((l) => <p key={l.id}><strong>{l.query}</strong><br/><span>{l.actor_type} #{l.actor_id} • {new Date(l.created_at).toLocaleString()}</span></p>)}</div>
  </section></main>;
}

function App() {
  const [profile, setProfile] = useState(getProfile());
  const [libraries, setLibraries] = useState([]), [settings, setSettings] = useState({}), [history, setHistory] = useState([]);
  const [screen, setScreen] = useState("home"), [selected, setSelected] = useState(null), [playerData, setPlayerData] = useState(null);
  const [searchQuery, setSearchQuery] = useState(""), [searchResults, setSearchResults] = useState(null), [searchPreview, setSearchPreview] = useState({ results: [], loading: false });
  async function refresh() { const me = await api("/me"); setProfile({ ...getProfile(), ...me }); const data = await api("/catalogs"); setLibraries(data.libraries || []); setSettings(data.settings || {}); setHistory((await api("/playback/history")).history || []); }
  useEffect(() => { if (profile) refresh().catch(() => { clearSession(); setProfile(null); }); }, []);
  if (!profile) return <AuthScreen onLogin={() => { setProfile(getProfile()); refresh(); }} />;
  function logout() { clearSession(); setProfile(null); }
  function openItem(item) { setSelected({ ...item, type: itemType(item) }); setScreen("details"); }
  async function doSearchPreview(q) { setSearchPreview((v) => ({ ...v, loading: true })); try { const data = await api("/search", { method: "POST", body: JSON.stringify({ query: q }) }); setSearchPreview({ ...data, loading: false }); } catch { setSearchPreview({ results: [], loading: false }); } }
  async function doSearch(q) { setSearchQuery(q); const data = await api("/search", { method: "POST", body: JSON.stringify({ query: q }) }); setSearchResults(data); setScreen("results"); }
  const featuredLibrary = useMemo(() => libraries.find((l) => l.key === settings.featured_catalog_key) || libraries.find((l) => String(l.catalog?.name || l.catalog?.id).toLowerCase() === "proponowane") || libraries.find((l) => l.items?.length), [libraries, settings.featured_catalog_key]);
  const featuredItems = (featuredLibrary?.items || []).map((i) => ({ ...i, type: featuredLibrary?.catalog?.type || itemType(i) }));
  if (screen === "admin") return <AdminPanel libraries={libraries} settings={settings} onSettingsSaved={refresh} onClose={() => { setScreen("home"); refresh(); }} />;
  if (screen === "results") return <><TopBar profile={profile} onLogout={logout} onSearch={doSearch} onSearchPreview={doSearchPreview} searchPreview={searchPreview} onOpenItem={openItem} onAdmin={() => setScreen("admin")} /><ResultsPage query={searchQuery} results={searchResults} onBack={() => setScreen("home")} onOpen={openItem} /></>;
  if (screen === "details" && selected) return <Details item={selected} history={history} onBack={() => setScreen("home")} onPlay={(item, streams = []) => { setPlayerData({ item, streams }); setScreen("player"); }} />;
  if (screen === "player" && playerData) return <Player item={playerData.item} initialStreams={playerData.streams} profile={profile} onClose={() => { setScreen("details"); refresh(); }} onLimitUpdate={(remaining) => { const next = { ...profile, remaining }; setProfile(next); localStorage.setItem("player_profile", JSON.stringify(next)); }} />;
  return <><TopBar profile={profile} onLogout={logout} onSearch={doSearch} onSearchPreview={doSearchPreview} searchPreview={searchPreview} onOpenItem={openItem} onAdmin={() => setScreen("admin")} /><Hero items={featuredItems} hasLibraries={libraries.length > 0} onOpen={openItem} /><main className="home">{libraries.map((library, index) => <Row key={library.key || index} library={library} onOpen={openItem} />)}</main></>;
}

createRoot(document.getElementById("root")).render(<App />);
