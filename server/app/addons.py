from __future__ import annotations

from urllib.parse import quote, urljoin
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
    return await fetch_json(base_url, f"catalog/{content_type}/{catalog_id}.json", timeout_seconds=25)


async def fetch_search(base_url: str, content_type: str, catalog_id: str, query: str) -> dict:
    safe_query = quote(query.strip())
    return await fetch_json(base_url, f"catalog/{content_type}/{catalog_id}/search={safe_query}.json", timeout_seconds=30)


async def fetch_meta(base_url: str, content_type: str, content_id: str) -> dict:
    return await fetch_json(base_url, f"meta/{content_type}/{content_id}.json", timeout_seconds=25)


async def fetch_streams(base_url: str, content_type: str, content_id: str) -> dict:
    # Pierwsze wyszukanie źródeł w wielu addonach bywa wolne, bo addon dopiero buduje własny cache.
    # Krótki timeout powodował fałszywe "brak źródeł" przy pierwszym odtworzeniu.
    return await fetch_json(base_url, f"stream/{content_type}/{content_id}.json", timeout_seconds=55)


async def fetch_subtitles(base_url: str, content_type: str, content_id: str) -> dict:
    return await fetch_json(base_url, f"subtitles/{content_type}/{content_id}.json", timeout_seconds=30)
