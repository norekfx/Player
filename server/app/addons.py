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


def stream_text(stream: dict) -> str:
    hints = stream.get("behaviorHints") or {}
    parts = [
        stream.get("name"),
        stream.get("title"),
        stream.get("quality"),
        stream.get("description"),
        stream.get("addon"),
        stream.get("url"),
        hints.get("filename"),
    ]
    return " ".join(str(part) for part in parts if part)


def detect_quality(stream: dict) -> str:
    text = stream_text(stream)
    match = re.search(r"(?<!\d)(2160|1440|1080|720|480|360)\s*p?(?!\d)", text, flags=re.I)
    return f"{match.group(1)}p" if match else str(stream.get("quality") or "")


def detect_container(stream: dict) -> str:
    text = stream_text(stream).lower()
    match = re.search(r"\.(mkv|mp4|m4v|webm|mov)(?:\b|$|[?&#])", text)
    if match:
        return match.group(1)
    for value in ("mkv", "mp4", "m4v", "webm"):
        if re.search(rf"(^|[^a-z0-9]){value}([^a-z0-9]|$)", text):
            return value
    return ""


def is_original_stream(stream: dict) -> bool:
    text = stream_text(stream).lower()
    return bool(re.search(r"(^|[^a-ząćęłńóśźż0-9])(oryginał|oryginal|original|source)([^a-ząćęłńóśźż0-9]|$)", text, flags=re.I))


def is_transcoded_stream(stream: dict) -> bool:
    text = stream_text(stream).lower()
    return bool(re.search(r"(^|[^a-z0-9])(auto|transcoded|transkod|4k|2160p|1440p|1080p|720p|480p|360p)([^a-z0-9]|$)", text, flags=re.I)) and not is_original_stream(stream)


def detect_audio_codec(stream: dict) -> str:
    text = stream_text(stream).lower()
    checks = [
        (r"\b(e-?ac-?3|eac3|ddp|dolby\s*digital\s*plus)\b", "eac3"),
        (r"\b(ac-?3|ac3|dolby\s*digital)\b", "ac3"),
        (r"\b(dts(?:-?hd)?|truehd|atmos)\b", "dts"),
        (r"\b(aac|mp4a|m4a)\b", "aac"),
        (r"\b(opus)\b", "opus"),
        (r"\b(vorbis|ogg)\b", "vorbis"),
        (r"\b(mp3|mpeg\s*audio)\b", "mp3"),
    ]
    for pattern, codec in checks:
        if re.search(pattern, text):
            return codec
    if is_original_stream(stream):
        return "unknown-original"
    if is_transcoded_stream(stream):
        return "transcoded"
    return ""


def is_browser_audio_risky(stream: dict) -> bool:
    return detect_audio_codec(stream) in {"ac3", "eac3", "dts", "unknown-original"}


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
    audio_codec = detect_audio_codec(normalized)
    container = detect_container(normalized)
    if audio_codec:
        normalized["audio_codec"] = audio_codec
    if container:
        normalized["container"] = container
    normalized["browser_audio_risky"] = is_browser_audio_risky(normalized)
    normalized["transcoded"] = is_transcoded_stream(normalized)
    normalized["original_stream"] = is_original_stream(normalized)
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
