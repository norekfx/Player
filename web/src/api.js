const API_BASE = "/api";
const UI_KEY = "player_ui_state_v1";

export function getToken() {
  return localStorage.getItem("player_token");
}

export function setSession(token, profile) {
  localStorage.setItem("player_token", token);
  localStorage.setItem("player_profile", JSON.stringify(profile));
  localStorage.removeItem(UI_KEY);
  sessionStorage.setItem("player_just_logged_in", "1");
  if (typeof window !== "undefined") {
    window.location.replace(window.location.pathname || "/");
  }
}

export function clearSession() {
  localStorage.removeItem("player_token");
  localStorage.removeItem("player_profile");
  localStorage.removeItem(UI_KEY);
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
    throw new Error("Limit odtworzeń został wykorzystany. Dostęp dla tego gościa jest zablokowany.");
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
