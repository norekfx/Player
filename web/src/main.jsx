import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Play, Search, Settings, User, LogOut, Plus, KeyRound, Clapperboard, Maximize, Gauge, SkipForward } from "lucide-react";
import { api, clearSession, getProfile, setSession } from "./api";
import "./styles.css";

function AuthScreen({ onLogin }) {
  const [bootstrap, setBootstrap] = useState(null);
  const [mode, setMode] = useState("admin");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [guestCode, setGuestCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/bootstrap").then(setBootstrap).catch((err) => setError(err.message));
  }, []);

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
    } catch (err) {
      setError(err.message);
    }
  }

  return <main className="auth-page">
    <section className="auth-card glass">
      <div className="brand"><Clapperboard /> <span>Player</span></div>
      <h1>{mode === "guest" ? "Logowanie gościa" : bootstrap?.needs_admin_registration ? "Pierwsza konfiguracja" : "Logowanie admina"}</h1>
      <p>{mode === "guest" ? "Wpisz 6-cyfrowy kod wygenerowany w panelu admina." : bootstrap?.needs_admin_registration ? "Utwórz pierwsze konto administratora. Później rejestracja będzie zablokowana." : "Zaloguj się do panelu i biblioteki."}</p>
      <form onSubmit={submit}>
        {mode !== "guest" ? <>
          <label>Nazwa użytkownika</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          <label>Hasło</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </> : <>
          <label>Kod gościa</label>
          <input value={guestCode} onChange={(e) => setGuestCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" />
        </>}
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">{mode === "guest" ? "Wejdź jako gość" : bootstrap?.needs_admin_registration ? "Utwórz admina" : "Zaloguj"}</button>
      </form>
      <button className="link" onClick={() => setMode(mode === "guest" ? "admin" : "guest")}>{mode === "guest" ? "Wróć do logowania admina" : "Zaloguj się jako gość"}</button>
    </section>
  </main>;
}

function TopBar({ profile, onLogout, onSearch, onAdmin }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  function submit(e) {
    e.preventDefault();
    if (q.trim()) onSearch(q.trim());
  }
  return <header className="topbar">
    <div className="brand"><Clapperboard /> <span>Player</span></div>
    <form className="search" onSubmit={submit}><Search size={18} /><input placeholder="Szukaj filmu lub serialu..." value={q} onChange={(e) => setQ(e.target.value)} /></form>
    {profile?.role === "guest" && <div className="limit">Limit: {profile.remaining ?? "?"}/{profile.limit ?? "?"}</div>}
    <div className="menu-wrap">
      <button className="icon" onClick={() => setOpen(!open)}><Settings /></button>
      {open && <div className="menu glass">
        <div><User size={16} /> {profile?.username || profile?.display_name || "Konto"}</div>
        {profile?.role === "admin" && <button onClick={onAdmin}><KeyRound size={16} /> Panel admina</button>}
        <button onClick={onLogout}><LogOut size={16} /> Wyloguj</button>
      </div>}
    </div>
  </header>;
}

function Hero({ item, onOpen }) {
  if (!item) return <section className="hero empty"><h1>Brak propozycji</h1><p>Dodaj addon w panelu admina, aby biblioteka mogła wyświetlić filmy i seriale.</p></section>;
  const bg = item.background || item.backdrop || item.poster;
  return <section className="hero" style={{ backgroundImage: bg ? `linear-gradient(90deg, #0b0b0f 0%, rgba(11,11,15,.72) 45%, rgba(11,11,15,.2)), url(${bg})` : undefined }}>
    <div className="hero-copy">
      <div className="eyebrow">Proponowane</div>
      <h1>{item.name}</h1>
      <p>{item.description || "Materiał z biblioteki addonu."}</p>
      <button className="primary" onClick={() => onOpen(item)}><Play size={18} /> Otwórz</button>
    </div>
  </section>;
}

function Row({ library, onOpen }) {
  return <section className="row"><h2>{library.catalog?.name || library.catalog?.id} <span>{library.addon}</span></h2>
    {library.error && <div className="error small">{library.error}</div>}
    <div className="cards">{(library.items || []).map((item) => <button className="poster" key={`${library.addon}-${item.id}`} onClick={() => onOpen({ ...item, type: library.catalog?.type || item.type || "movie" })}>
      {item.poster ? <img src={item.poster} alt="" /> : <div className="poster-fallback">{item.name}</div>}
      <strong>{item.name}</strong>
    </button>)}</div>
  </section>;
}

function Details({ item, onBack, onPlay }) {
  const [meta, setMeta] = useState(item);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [streams, setStreams] = useState([]);

  useEffect(() => {
    let active = true;
    api(`/meta/${item.type || "movie"}/${encodeURIComponent(item.id)}`).then((data) => {
      if (active) setMeta({ ...item, ...data.meta });
    }).catch(() => {});
    setLoadingStreams(true);
    api(`/streams/${item.type || "movie"}/${encodeURIComponent(item.id)}`).then((data) => {
      if (active) setStreams(data.streams || []);
    }).catch(() => {}).finally(() => setLoadingStreams(false));
    return () => { active = false; };
  }, [item.id]);

  const bg = meta.background || meta.backdrop || meta.poster;
  const videos = meta.videos || [];
  return <main className="details" style={{ backgroundImage: bg ? `linear-gradient(180deg, rgba(11,11,15,.35), #0b0b0f 52%), url(${bg})` : undefined }}>
    <button className="link back" onClick={onBack}>← Wróć</button>
    <section className="details-grid">
      {meta.poster && <img className="detail-poster" src={meta.poster} alt="" />}
      <div>
        <h1>{meta.name}</h1>
        <p>{meta.description || "Brak opisu w addonie."}</p>
        <button className="primary" disabled={!streams.length} onClick={() => onPlay(meta, streams)}><Play size={18} /> {loadingStreams ? "Szukam źródeł..." : streams.length ? "Odtwarzaj" : "Brak streamów"}</button>
        {streams.length > 0 && <p className="muted">Znaleziono źródeł: {streams.length}</p>}
      </div>
    </section>
    {videos.length > 0 && <section className="episodes"><h2>Odcinki</h2><div className="episode-grid">{videos.map((ep) => <button key={ep.id} onClick={() => onPlay({ ...meta, id: ep.id, episode: ep.episode, season: ep.season, name: ep.title || meta.name }, streams)}>
      {ep.thumbnail && <img src={ep.thumbnail} alt="" />}<span>S{ep.season} E{ep.episode}</span><strong>{ep.title || "Odcinek"}</strong>
    </button>)}</div></section>}
  </main>;
}

function Player({ item, streams, profile, onClose, onLimitUpdate }) {
  const videoRef = useRef(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const stream = streams[streamIndex];

  useEffect(() => {
    api("/playback/start", { method: "POST", body: JSON.stringify({ content_type: item.type || "movie", content_id: item.id, title: item.name, season: item.season, episode: item.episode }) })
      .then((data) => {
        if (profile?.role === "guest" && data.remaining !== null) {
          setNotice(`Pozostało ci ${data.remaining} z ${profile.limit} limitu odtworzonych filmów`);
          onLimitUpdate?.(data.remaining);
          setTimeout(() => setNotice(""), 4500);
        }
      }).catch((err) => setNotice(err.message));
  }, []);

  function fullscreen() {
    videoRef.current?.requestFullscreen?.();
  }

  return <main className="player-page">
    <button className="link back" onClick={onClose}>← Zamknij odtwarzacz</button>
    <h1>{item.name}</h1>
    {notice && <div className="toast">{notice}</div>}
    <div className="player-shell">
      <video ref={videoRef} src={stream?.url} controls={false} poster={item.background || item.poster} />
      <div className="player-controls glass">
        <button onClick={() => videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause()}><Play /></button>
        <button title="Poprzedni odcinek"><SkipForward className="flip" /></button>
        <button title="Następny odcinek"><SkipForward /></button>
        <select value={streamIndex} onChange={(e) => setStreamIndex(Number(e.target.value))}>{streams.map((s, i) => <option key={i} value={i}>{s.name || s.title || s.addon || `Stream ${i + 1}`}</option>)}</select>
        <select onChange={(e) => { videoRef.current.playbackRate = Number(e.target.value); }}><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select>
        <button title="Pomiń intro" className="intro"><Gauge /> Pomiń intro</button>
        <button onClick={fullscreen}><Maximize /></button>
      </div>
    </div>
  </main>;
}

function AdminPanel({ onClose }) {
  const [addons, setAddons] = useState([]);
  const [guests, setGuests] = useState([]);
  const [logs, setLogs] = useState([]);
  const [url, setUrl] = useState("");
  const [guestName, setGuestName] = useState("Gość");
  const [limit, setLimit] = useState(10);
  const [newCode, setNewCode] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setAddons((await api("/addons")).addons || []);
    setGuests((await api("/admin/guests")).guests || []);
    setLogs((await api("/admin/logs/searches")).logs || []);
  }
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  async function installAddon(e) {
    e.preventDefault();
    setError("");
    try { await api("/admin/addons", { method: "POST", body: JSON.stringify({ url }) }); setUrl(""); await load(); } catch (err) { setError(err.message); }
  }
  async function createGuest(e) {
    e.preventDefault();
    const data = await api("/admin/guests", { method: "POST", body: JSON.stringify({ display_name: guestName, play_limit: Number(limit) }) });
    setNewCode(data.code);
    await load();
  }

  return <main className="admin"><button className="link back" onClick={onClose}>← Wróć</button><h1>Panel admina</h1>{error && <div className="error">{error}</div>}
    <section className="admin-grid">
      <div className="glass panel"><h2><Plus /> Addony</h2><form onSubmit={installAddon}><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://adres-addonu/" /><button className="primary">Dodaj addon</button></form>{addons.map((a) => <p key={a.id}><strong>{a.name}</strong><br/><span>{a.url}</span></p>)}</div>
      <div className="glass panel"><h2><KeyRound /> Goście</h2><form onSubmit={createGuest}><input value={guestName} onChange={(e) => setGuestName(e.target.value)} /><input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} /><button className="primary">Wygeneruj kod</button></form>{newCode && <div className="code">Nowy kod: {newCode}</div>}{guests.map((g) => <p key={g.id}>{g.display_name}: {g.remaining}/{g.limit} • {g.active ? "aktywny" : "zatrzymany"}</p>)}</div>
      <div className="glass panel"><h2>Wyszukiwania</h2>{logs.map((l) => <p key={l.id}><strong>{l.query}</strong><br/><span>{l.actor_type} #{l.actor_id} • {new Date(l.created_at).toLocaleString()}</span></p>)}</div>
    </section>
  </main>;
}

function App() {
  const [profile, setProfile] = useState(getProfile());
  const [libraries, setLibraries] = useState([]);
  const [screen, setScreen] = useState("home");
  const [selected, setSelected] = useState(null);
  const [playerData, setPlayerData] = useState(null);
  const [searchResults, setSearchResults] = useState(null);

  async function refresh() {
    const me = await api("/me");
    setProfile({ ...getProfile(), ...me });
    const data = await api("/catalogs");
    setLibraries(data.libraries || []);
  }
  useEffect(() => { if (profile) refresh().catch(() => { clearSession(); setProfile(null); }); }, []);
  if (!profile) return <AuthScreen onLogin={() => { setProfile(getProfile()); refresh(); }} />;

  function logout() { clearSession(); setProfile(null); }
  async function doSearch(q) { const data = await api("/search", { method: "POST", body: JSON.stringify({ query: q }) }); setSearchResults(data.results || []); setScreen("home"); }
  const proposed = useMemo(() => libraries.find((l) => String(l.catalog?.name || l.catalog?.id).toLowerCase() === "proponowane")?.items?.[0] || libraries[0]?.items?.[0], [libraries]);

  if (screen === "admin") return <AdminPanel onClose={() => { setScreen("home"); refresh(); }} />;
  if (screen === "details" && selected) return <Details item={selected} onBack={() => setScreen("home")} onPlay={(item, streams) => { setPlayerData({ item, streams }); setScreen("player"); }} />;
  if (screen === "player" && playerData) return <Player item={playerData.item} streams={playerData.streams} profile={profile} onClose={() => setScreen("details")} onLimitUpdate={(remaining) => { const next = { ...profile, remaining }; setProfile(next); localStorage.setItem("player_profile", JSON.stringify(next)); }} />;

  return <>
    <TopBar profile={profile} onLogout={logout} onSearch={doSearch} onAdmin={() => setScreen("admin")} />
    <Hero item={proposed} onOpen={(item) => { setSelected({ ...item, type: item.type || "movie" }); setScreen("details"); }} />
    <main className="home">
      {searchResults && <Row library={{ addon: "Wyniki", catalog: { name: "Wyniki wyszukiwania" }, items: searchResults }} onOpen={(item) => { setSelected(item); setScreen("details"); }} />}
      {libraries.map((library, index) => <Row key={index} library={library} onOpen={(item) => { setSelected(item); setScreen("details"); }} />)}
    </main>
  </>;
}

createRoot(document.getElementById("root")).render(<App />);
