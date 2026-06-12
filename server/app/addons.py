from __future__ import annotations

from urllib.parse import quote, urljoin
import re
import httpx


class AddonError(RuntimeError):
    pass


def normalize_addon_url(url: str) -> str:
    cleaned = url.strip()
    if not cleaned:
        raise AddonError("Podaj adres URL addonu.")
    if not cleaned.startswith(("http://", "https://")):
        raise AddonError("Adres addonu musi zaczynać się od http:// albo https://")
    if cleaned.endswith("/manifest.json"):
        cleaned = cleaned[: -len("/manifest.json")]
    return cleaned.rstrip("/") + "/"


def safe_path_part(value: str) -> str:
    return quote(str(value or "").strip(), safe="")


def normalize_stream_label(value: str) -> str:
    text = str(value or "").replace("_", " ").strip()
    text = re.sub(r"\s+", " ", text)
    text = re.split(r"\s+(?:🇵🇱\s*)?Tłumaczenie\s*:", text, maxsplit=1, flags=re.I)[0].strip()
    text = re.split(r"\s*\|\s*Korekta\s*:", text, maxsplit=1, flags=re.I)[0].strip()
    text = re.sub(r"\s*🔗\s*", " • ", text).strip(" -•|")
    return text


def stream_text(stream: dict) -> str:
    hints = stream.get("behaviorHints") or {}
    parts = [
        stream.get("name"),
        stream.get("title"),
        stream.get("quality"),
        stream.get("description"),
        hints.get("filename"),
    ]
    return " ".join(str(part) for part in parts if part)


def detect_quality(stream: dict) -> str:
    text = stream_text(stream)
    match = re.search(r"(?<!\d)(2160|1440|1080|720|480|360)\s*p?(?!\d)", text, flags=re.I)
    return f"{match.group(1)}p" if match else str(stream.get("quality") or "")


def normalize_stream(stream: dict) -> dict:
    if not isinstance(stream, dict):
        return {}
    normalized = dict(stream)
    url = normalized.get("url") or normalized.get("externalUrl") or normalized.get("file")
    if url:
        normalized["url"] = url
    quality = detect_quality(normalized)
    if quality:
        normalized["quality"] = quality
    hints = normalized.get("behaviorHints") or {}
    raw_label = normalized.get("name") or normalized.get("title") or hints.get("filename") or quality
    label = normalize_stream_label(raw_label)
    if quality and quality.lower() not in label.lower():
        label = f"{quality} {label}".strip()
    if label:
        normalized["name"] = label
    return normalized


async def fetch_json(base_url: str, path: str, timeout_seconds: float = 15) -> dict:
    url = urljoin(normalize_addon_url(base_url), path.lstrip("/"))
    try:
        timeout = httpx.Timeout(timeout_seconds, connect=10)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers={"Accept": "application/json"})
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        raise AddonError(f"Addon zwrócił błąd HTTP {exc.response.status_code} dla {url}") from exc
    except httpx.ConnectError as exc:
        raise AddonError(f"Nie można połączyć się z addonem: {url}") from exc
    except httpx.TimeoutException as exc:
        raise AddonError(f"Przekroczono czas oczekiwania na addon po {timeout_seconds}s: {url}") from exc
    except ValueError as exc:
        raise AddonError(f"Addon nie zwrócił poprawnego JSON: {url}") from exc
    except httpx.HTTPError as exc:
        raise AddonError(f"Błąd pobierania addonu: {exc}") from exc

    if not isinstance(data, dict):
        raise AddonError("Addon zwrócił JSON, ale nie jest to obiekt.")
    return data


async def fetch_manifest(base_url: str) -> dict:
    manifest = await fetch_json(base_url, "manifest.json", timeout_seconds=20)
    if "id" not in manifest or "name" not in manifest:
        raise AddonError("Manifest addonu musi zawierać pola 'id' i 'name'.")
    if "catalogs" not in manifest:
        manifest["catalogs"] = []
    return manifest


async def fetch_catalog(base_url: str, content_type: str, catalog_id: str) -> dict:
    return await fetch_json(base_url, f"catalog/{safe_path_part(content_type)}/{safe_path_part(catalog_id)}.json", timeout_seconds=25)


async def fetch_search(base_url: str, content_type: str, catalog_id: str, query: str) -> dict:
    safe_query = quote(query.strip())
    return await fetch_json(base_url, f"catalog/{safe_path_part(content_type)}/{safe_path_part(catalog_id)}/search={safe_query}.json", timeout_seconds=30)


async def fetch_meta(base_url: str, content_type: str, content_id: str) -> dict:
    return await fetch_json(base_url, f"meta/{safe_path_part(content_type)}/{safe_path_part(content_id)}.json", timeout_seconds=25)


async def fetch_streams(base_url: str, content_type: str, content_id: str) -> dict:
    # Pierwsze wyszukanie źródeł w wielu addonach bywa wolne, bo addon dopiero buduje własny cache.
    # Krótki timeout powodował fałszywe "brak źródeł" przy pierwszym odtworzeniu.
    data = await fetch_json(base_url, f"stream/{safe_path_part(content_type)}/{safe_path_part(content_id)}.json", timeout_seconds=55)
    data["streams"] = [stream for stream in (normalize_stream(item) for item in data.get("streams", [])) if stream.get("url")]
    return data


async def fetch_subtitles(base_url: str, content_type: str, content_id: str) -> dict:
    return await fetch_json(base_url, f"subtitles/{safe_path_part(content_type)}/{safe_path_part(content_id)}.json", timeout_seconds=30)
