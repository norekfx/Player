const API_BASE = "/api";

export function getToken() {
  return localStorage.getItem("player_token");
}

export function setSession(token, profile) {
  localStorage.setItem("player_token", token);
  localStorage.setItem("player_profile", JSON.stringify(profile));
}

export function clearSession() {
  localStorage.removeItem("player_token");
  localStorage.removeItem("player_profile");
}

export function getProfile() {
  try {
    return JSON.parse(localStorage.getItem("player_profile") || "null");
  } catch {
    return null;
  }
}

export async function api(path, options = {}) {
  const token = getToken();
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
