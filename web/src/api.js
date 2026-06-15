const API_BASE = "/api";
const UI_KEY = "player_ui_state_v1";
const LIMIT_VIEW_KEY = "player_limit_exhausted_view_v1";
const SILENT_AUDIO_POPUP_KEY = "player_silent_audio_popup_seen_v1";
const BUFFER_POPUP_KEY = "player_buffering_popup_seen_v1";

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

const audioFallbackState = { bound: new WeakSet(), originalUrl: "", originalLabel: "", handledSrc: "" };
function streamOptionText(option) { return String(option?.textContent || "").trim(); }
function isOriginalStreamLabel(text) { return /original|orygina/i.test(String(text || "")); }
function is720pStreamLabel(text) { return /(^|[^0-9])720(p)?([^0-9]|$)/i.test(String(text || "")); }
function streamQualitySelect() { if (typeof document === "undefined") return null; return [...document.querySelectorAll(".player-controls select")].find((select) => [...select.options].some((option) => is720pStreamLabel(streamOptionText(option)))) || null; }
function selectedStreamOption(select) { return select?.options?.[select.selectedIndex] || null; }
function currentStreamLooksOriginal() { const select = streamQualitySelect(); return isOriginalStreamLabel(streamOptionText(selectedStreamOption(select))); }
function rememberOriginalStream(video) { const select = streamQualitySelect(); const label = streamOptionText(selectedStreamOption(select)); if (!isOriginalStreamLabel(label)) return; audioFallbackState.originalUrl = video.currentSrc || video.src || audioFallbackState.originalUrl; audioFallbackState.originalLabel = label || audioFallbackState.originalLabel; }
function closeAudioFallbackPopup() { document.querySelector(".audio-codec-modal")?.remove(); }
function addAudioPopupParagraph(parent, text) { const paragraph = document.createElement("p"); paragraph.textContent = text; parent.appendChild(paragraph); }
function showAudioFallbackPopup(originalUrl, originalLabel) {
  if (typeof document === "undefined") return;
  closeAudioFallbackPopup();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop audio-codec-modal";
  const modal = document.createElement("div");
  modal.className = "modal glass";
  const title = document.createElement("h2");
  title.textContent = "Audio może nie być obsługiwane";
  modal.appendChild(title);
  addAudioPopupParagraph(modal, "Wykryto, że dźwięk w wersji Original może nie być odtwarzany przez tę przeglądarkę.");
  addAudioPopupParagraph(modal, "Nie każda przeglądarka obsługuje wszystkie kodeki audio i kontenery wideo. Plik może zawierać ścieżkę audio w formacie, którego ta przeglądarka nie potrafi zdekodować, mimo że obraz działa.");
  addAudioPopupParagraph(modal, "Zmieniono na wersję transkodowaną 720p. Transkodowanie zwykle poprawia zgodność, ale może się przycinać w zależności od oryginalnego wideo, jego jakości oraz obciążenia serwera.");
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px";
  const closeButton = document.createElement("button");
  closeButton.className = "primary";
  closeButton.type = "button";
  closeButton.textContent = "Zamknij";
  closeButton.addEventListener("click", closeAudioFallbackPopup);
  actions.appendChild(closeButton);
  if (originalUrl) {
    const downloadButton = document.createElement("button");
    downloadButton.className = "danger";
    downloadButton.type = "button";
    downloadButton.textContent = "Pobierz Original";
    downloadButton.addEventListener("click", () => window.open(originalUrl, "_blank", "noopener,noreferrer"));
    actions.appendChild(downloadButton);
  }
  modal.appendChild(actions);
  if (originalLabel) {
    const source = document.createElement("small");
    source.style.cssText = "display:block;margin-top:14px;color:#bbb;overflow-wrap:anywhere";
    source.textContent = `Oryginalne źródło: ${originalLabel}`;
    modal.appendChild(source);
  }
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}
function switchOriginalTo720p() {
  const select = streamQualitySelect();
  if (!select) return false;
  const current = selectedStreamOption(select);
  if (is720pStreamLabel(streamOptionText(current))) return false;
  const candidate = [...select.options].find((option) => is720pStreamLabel(streamOptionText(option)));
  if (!candidate) return false;
  const video = document.querySelector(".player-shell video");
  const originalUrl = audioFallbackState.originalUrl || video?.currentSrc || video?.src || "";
  const originalLabel = audioFallbackState.originalLabel || streamOptionText(current) || "Original";
  select.value = candidate.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  setTimeout(() => showAudioFallbackPopup(originalUrl, originalLabel), 150);
  return true;
}
function probeOriginalAudio(video) {
  if (!currentStreamLooksOriginal()) return;
  rememberOriginalStream(video);
  const src = video.currentSrc || video.src || "";
  if (!src || audioFallbackState.handledSrc === src) return;
  const hasAudioCounter = "webkitAudioDecodedByteCount" in video;
  const startAudioBytes = Number(video.webkitAudioDecodedByteCount || 0);
  const startTime = Number(video.currentTime || 0);
  setTimeout(() => {
    if (!document.body.contains(video)) return;
    if (!currentStreamLooksOriginal()) return;
    if ((video.currentSrc || video.src || "") !== src) return;
    const endAudioBytes = Number(video.webkitAudioDecodedByteCount || 0);
    const endTime = Number(video.currentTime || 0);
    const videoIsAdvancing = endTime > Math.max(3, startTime + 2);
    const userExpectsAudio = !video.muted && Number(video.volume || 0) > 0;
    const noDecodedAudio = hasAudioCounter && endAudioBytes <= startAudioBytes;
    if (videoIsAdvancing && userExpectsAudio && noDecodedAudio) {
      audioFallbackState.handledSrc = src;
      switchOriginalTo720p();
    }
  }, 6500);
}
function bindAudioFallbackVideo(video) {
  if (!video || audioFallbackState.bound.has(video)) return;
  audioFallbackState.bound.add(video);
  ["loadedmetadata", "canplay", "playing"].forEach((eventName) => {
    video.addEventListener(eventName, () => { rememberOriginalStream(video); probeOriginalAudio(video); });
  });
  video.addEventListener("error", () => { if (currentStreamLooksOriginal()) { rememberOriginalStream(video); switchOriginalTo720p(); } });
}
function scanAudioFallbackVideos() { if (typeof document === "undefined") return; document.querySelectorAll(".player-shell video").forEach(bindAudioFallbackVideo); }

if (typeof window !== "undefined") {
  const enforceLimitView = () => {
    if (sessionStorage.getItem(LIMIT_VIEW_KEY) === "1" || profileLimitExhausted()) {
      showLimitExhaustedPlayerView();
    }
  };

  const tick = () => { enforceLimitView(); scanAudioFallbackVideos(); };
  const observer = new MutationObserver(tick);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  window.addEventListener("DOMContentLoaded", tick);
  window.addEventListener("popstate", tick);
  setTimeout(tick, 0);
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
