const API_BASE = "/api";
const UI_KEY = "player_ui_state_v1";
const LIMIT_VIEW_KEY = "player_limit_exhausted_view_v1";
const HLS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
const SILENT_AUDIO_POPUP_KEY = "player_silent_audio_popup_seen_v1";
const BUFFER_POPUP_KEY = "player_buffering_popup_seen_v1";
const BUFFER_SWITCH_MS = 15000;

const bufferingState = new Map();

export function getToken() {
  return localStorage.getItem("player_token");
}

export function setSession(token, profile) {
  localStorage.setItem("player_token", token);
  localStorage.setItem("player_profile", JSON.stringify(profile));
  localStorage.removeItem(UI_KEY);
  sessionStorage.removeItem(LIMIT_VIEW_KEY);
  sessionStorage.removeItem(SILENT_AUDIO_POPUP_KEY);
  sessionStorage.removeItem(BUFFER_POPUP_KEY);
  sessionStorage.setItem("player_just_logged_in", "1");
  if (typeof window !== "undefined") {
    window.location.replace(window.location.pathname || "/");
  }
}

export function clearSession() {
  localStorage.removeItem("player_token");
  localStorage.removeItem("player_profile");
  localStorage.removeItem(UI_KEY);
  sessionStorage.removeItem(LIMIT_VIEW_KEY);
  sessionStorage.removeItem(SILENT_AUDIO_POPUP_KEY);
  sessionStorage.removeItem(BUFFER_POPUP_KEY);
}

export function getProfile() {
  try {
    return JSON.parse(localStorage.getItem("player_profile") || "null");
  } catch {
    return null;
  }
}

export function consumeJustLoggedIn() {
  const value = sessionStorage.getItem("player_just_logged_in") === "1";
  sessionStorage.removeItem("player_just_logged_in");
  return value;
}

function profileLimitExhausted() {
  const profile = getProfile();
  if (profile?.role !== "guest") return false;
  const remaining = Number(profile.remaining ?? 0);
  return profile.limit_exhausted || remaining <= 0;
}

function showLimitExhaustedPlayerView() {
  if (typeof document === "undefined") return;
  const page = document.querySelector(".player-page");
  if (!page) return;

  page.querySelectorAll(".player-shell, .toast, .loading-overlay").forEach((node) => node.remove());
  page.querySelectorAll(".limit-exhausted-screen").forEach((node, index) => { if (index > 0) node.remove(); });
  if (page.querySelector(".limit-exhausted-screen")) return;

  const screen = document.createElement("section");
  screen.className = "limit-exhausted-screen glass";
  screen.style.cssText = "min-height:55vh;display:grid;place-items:center;text-align:center;border-radius:28px;margin:28px 0;padding:36px;background:rgba(0,0,0,.72);";
  screen.innerHTML = '<h2 style="font-size:clamp(32px,6vw,72px);margin:0;color:#fff">Skończył się limit :(</h2>';

  const title = page.querySelector("h1");
  if (title?.nextSibling) page.insertBefore(screen, title.nextSibling);
  else page.appendChild(screen);
}

function markLimitExhaustedView() {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(LIMIT_VIEW_KEY, "1");
  showLimitExhaustedPlayerView();
}

function showPlayerToast(message) {
  if (typeof document === "undefined") return;
  let toast = document.querySelector(".player-page .toast") || document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    (document.querySelector(".player-page") || document.body).appendChild(toast);
  }
  toast.textContent = message;
}

function isHlsUrl(url) {
  return /\.m3u8(\?|#|$)/i.test(String(url || ""));
}

function currentStreamText() {
  const select = [...document.querySelectorAll(".player-page .compact-select select")].find((item) => item.options?.length > 1);
  const option = select ? ([...select.options].find((item) => item.selected) || select.options[Number(select.value)] || select.options[0]) : null;
  return option?.textContent || document.querySelector(".player-page h1")?.textContent || "aktualny stream";
}

function currentStreamUrl() {
  const video = document.querySelector(".player-page video");
  return video?.currentSrc || video?.src || video?.getAttribute("src") || "";
}

function popupSeen(key) {
  try { return JSON.parse(sessionStorage.getItem(SILENT_AUDIO_POPUP_KEY) || "{}")[key]; } catch { return false; }
}

function markPopupSeen(key) {
  try {
    const seen = JSON.parse(sessionStorage.getItem(SILENT_AUDIO_POPUP_KEY) || "{}");
    seen[key] = Date.now();
    sessionStorage.setItem(SILENT_AUDIO_POPUP_KEY, JSON.stringify(seen));
  } catch {}
}

function closeAudioPopup() {
  document.querySelector(".silent-audio-modal")?.remove();
}

function showSilentAudioPopup(reason = "Nie udało się wykryć dekodowanego dźwięku") {
  if (typeof document === "undefined") return;
  const url = currentStreamUrl();
  const text = currentStreamText();
  const key = `${url}|${text}`.slice(0, 260);
  if (!url || popupSeen(key) || document.querySelector(".silent-audio-modal")) return;
  markPopupSeen(key);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop silent-audio-modal";
  backdrop.innerHTML = `
    <div class="modal glass">
      <h2>Możliwy problem z dźwiękiem</h2>
      <p>${reason}. Film może mieć kodek audio, którego przeglądarka nie obsługuje, nawet jeśli nazwa streamu nie pokazuje kodeka.</p>
      <p>Możesz spróbować zmienić jakość w odtwarzaczu. Wideo może wtedy nie być płynne albo może mieć gorszą jakość. Wyższe jakości mogą ładować się dłużej, ponieważ są transkodowane.</p>
      <p>Alternatywnie możesz pobrać film i odtworzyć go w zewnętrznym odtwarzaczu.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="primary silent-audio-close" type="button">Zamknij</button>
        <button class="danger silent-audio-download" type="button">Pobierz</button>
      </div>
    </div>`;
  backdrop.querySelector(".silent-audio-close").addEventListener("click", closeAudioPopup);
  backdrop.querySelector(".silent-audio-download").addEventListener("click", () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    closeAudioPopup();
  });
  document.body.appendChild(backdrop);
}

function getBufferSeen() {
  try { return JSON.parse(sessionStorage.getItem(BUFFER_POPUP_KEY) || "{}"); } catch { return {}; }
}

function markBufferSeen(key) {
  try {
    const seen = getBufferSeen();
    seen[key] = Date.now();
    sessionStorage.setItem(BUFFER_POPUP_KEY, JSON.stringify(seen));
  } catch {}
}

function closeBufferPopup() {
  document.querySelector(".buffering-modal")?.remove();
}

function showBufferingPopup() {
  if (typeof document === "undefined") return;
  const key = currentStreamUrl() || currentStreamText();
  const seen = getBufferSeen();
  if (!key || seen[key] || document.querySelector(".buffering-modal")) return;
  markBufferSeen(key);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop buffering-modal";
  backdrop.innerHTML = `
    <div class="modal glass">
      <h2>Przełączono jakość</h2>
      <p>Z powodu długiego buforowania przełączono na 720p.</p>
      <p>Niższa jakość może uruchomić się szybciej i działać płynniej.</p>
      <button class="primary buffering-close" type="button">Zamknij</button>
    </div>`;
  backdrop.querySelector(".buffering-close").addEventListener("click", closeBufferPopup);
  document.body.appendChild(backdrop);
}

function streamSelect() {
  return [...document.querySelectorAll(".player-page .compact-select select")].find((select) => {
    const text = [...select.options].map((option) => option.textContent || "").join(" ");
    return select.options.length > 1 && (/720|1080|2160|4k|stream|torrentio|webrip|bluray|hls|cda/i.test(text));
  });
}

function selectedOptionText(select) {
  const option = select ? ([...select.options].find((item) => item.selected) || select.options[Number(select.value)] || select.options[0]) : null;
  return option?.textContent || "";
}

function switchTo720p() {
  const select = streamSelect();
  if (!select) return false;
  const currentText = selectedOptionText(select);
  if (/720/i.test(currentText)) return false;
  const options = [...select.options];
  const candidate = options.find((option) => /(^|[^0-9])720(p)?([^0-9]|$)/i.test(option.textContent || ""));
  if (!candidate || candidate.value === select.value) return false;
  select.value = candidate.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  showBufferingPopup();
  return true;
}

function loadingOverlay() {
  return [...document.querySelectorAll(".player-page .loading-overlay")].find((overlay) => /Szukam źródeł|Szukam zrodel|Ładuje film|Laduje film/i.test(overlay.textContent || ""));
}

function setLoadingFilmText() {
  const overlay = loadingOverlay();
  if (!overlay) return false;
  const span = overlay.querySelector("span");
  if (span) span.textContent = "Ładuje film...";
  else overlay.textContent = "Ładuje film...";
  return true;
}

function scanLongBuffering() {
  if (typeof document === "undefined") return;
  const page = document.querySelector(".player-page");
  if (!page) return;
  const select = streamSelect();
  const overlayVisible = setLoadingFilmText();
  const video = page.querySelector("video");
  const src = video?.currentSrc || video?.src || video?.getAttribute("src") || "";
  const key = src || selectedOptionText(select) || page.querySelector("h1")?.textContent || "player-buffering";
  if (!select || !overlayVisible) {
    bufferingState.delete(key);
    return;
  }
  const timelineReady = video && (Number.isFinite(video.duration) && video.duration > 0 || video.readyState >= 3 || video.currentTime > 1);
  if (timelineReady && !video.paused) {
    bufferingState.delete(key);
    return;
  }
  if (!bufferingState.has(key)) bufferingState.set(key, Date.now());
  const started = bufferingState.get(key);
  if (Date.now() - started >= BUFFER_SWITCH_MS) {
    const switched = switchTo720p();
    bufferingState.delete(key);
    if (!switched) showPlayerToast("Film długo się buforuje. Nie znaleziono automatycznej opcji 720p dla tego źródła.");
  }
}

let hlsScriptPromise = null;
function loadHlsScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsScriptPromise) return hlsScriptPromise;
  hlsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = HLS_SCRIPT_URL;
    script.async = true;
    script.onload = () => window.Hls ? resolve(window.Hls) : reject(new Error("HLS loader unavailable"));
    script.onerror = () => reject(new Error("HLS loader failed"));
    document.head.appendChild(script);
  });
  return hlsScriptPromise;
}

async function attachHlsIfNeeded(video) {
  if (!video) return;
  const src = video.currentSrc || video.src || video.getAttribute("src") || "";
  if (!isHlsUrl(src)) return;
  if (video.canPlayType("application/vnd.apple.mpegurl")) return;
  if (video.__playerHlsSrc === src && video.__playerHlsAttached) return;

  try {
    const Hls = await loadHlsScript();
    if (!Hls.isSupported()) return;
    if (video.__playerHls) video.__playerHls.destroy();
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 60 });
    video.__playerHls = hls;
    video.__playerHlsSrc = src;
    video.__playerHlsAttached = true;
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data?.fatal) {
        showPlayerToast("Nie udało się odtworzyć strumienia HLS. Źródło może blokować odtwarzanie w przeglądarce albo wymagać zewnętrznego odtwarzacza.");
      }
    });
  } catch {
    showPlayerToast("Ten strumień jest w formacie HLS (.m3u8), a przeglądarka nie uruchomiła obsługi HLS.");
  }
}

function scanHlsVideos() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("video").forEach((video) => attachHlsIfNeeded(video));
}

function scanSilentAudio() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".player-page video").forEach((video) => {
    if (!video.currentSrc && !video.src) return;
    if (video.paused || video.currentTime < 7 || video.readyState < 2) return;
    if (video.muted || video.volume === 0) return;
    if (!("webkitAudioDecodedByteCount" in video)) return;
    const audioBytes = Number(video.webkitAudioDecodedByteCount || 0);
    if (audioBytes === 0) showSilentAudioPopup("Obraz jest odtwarzany, ale przeglądarka nie dekoduje żadnego audio");
  });
}

if (typeof window !== "undefined") {
  const shouldShowLimitView = () => sessionStorage.getItem(LIMIT_VIEW_KEY) === "1" || profileLimitExhausted();
  const enforceLimitView = () => { if (shouldShowLimitView()) showLimitExhaustedPlayerView(); };
  const observer = new MutationObserver(() => { enforceLimitView(); scanHlsVideos(); scanSilentAudio(); scanLongBuffering(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src"] });
  setInterval(() => { enforceLimitView(); scanHlsVideos(); scanSilentAudio(); scanLongBuffering(); }, 1000);
}

async function assertGuestCanRequestStreams(token) {
  if (!token) return;
  const localProfile = getProfile();
  if (localProfile?.role !== "guest") return;

  const response = await fetch(`${API_BASE}/me`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const me = await response.json().catch(() => ({}));
  if (!response.ok) return;

  if (me?.role === "guest") {
    localStorage.setItem("player_profile", JSON.stringify({ ...localProfile, ...me }));
  }

  const remaining = Number(me?.remaining ?? localProfile?.remaining ?? 0);
  if (me?.limit_exhausted || remaining <= 0) {
    markLimitExhaustedView();
    throw new Error("Skończył się limit :(");
  }
}

export async function api(path, options = {}) {
  const token = getToken();
  if (String(path).startsWith("/streams/")) {
    await assertGuestCanRequestStreams(token);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : data.detail?.message || "Błąd API");
  }
  return data;
}
