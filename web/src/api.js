const API_BASE = "/api";
const UI_KEY = "player_ui_state_v1";
const LIMIT_VIEW_KEY = "player_limit_exhausted_view_v1";
const HLS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";

export function getToken() {
  return localStorage.getItem("player_token");
}

export function setSession(token, profile) {
  localStorage.setItem("player_token", token);
  localStorage.setItem("player_profile", JSON.stringify(profile));
  localStorage.removeItem(UI_KEY);
  sessionStorage.removeItem(LIMIT_VIEW_KEY);
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

if (typeof window !== "undefined") {
  const shouldShowLimitView = () => sessionStorage.getItem(LIMIT_VIEW_KEY) === "1" || profileLimitExhausted();
  const enforceLimitView = () => { if (shouldShowLimitView()) showLimitExhaustedPlayerView(); };
  const observer = new MutationObserver(() => { enforceLimitView(); scanHlsVideos(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src"] });
  setInterval(() => { enforceLimitView(); scanHlsVideos(); }, 500);
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
