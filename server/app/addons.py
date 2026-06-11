from __future__ import annotations

from urllib.parse import urljoin
import httpx


class AddonError(RuntimeError):
    pass


def normalize_addon_url(url: str) -> str:
    return url.rstrip("/") + "/"


async def fetch_json(base_url: str, path: str) -> dict:
    url = urljoin(normalize_addon_url(base_url), path.lstrip("/"))
    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise AddonError("Addon returned non-object JSON")
        return data


async def fetch_manifest(base_url: str) -> dict:
    manifest = await fetch_json(base_url, "manifest.json")
    if "id" not in manifest or "name" not in manifest:
        raise AddonError("Manifest must include id and name")
    return manifest


async def fetch_catalog(base_url: str, content_type: str, catalog_id: str) -> dict:
    return await fetch_json(base_url, f"catalog/{content_type}/{catalog_id}.json")


async def fetch_meta(base_url: str, content_type: str, content_id: str) -> dict:
    return await fetch_json(base_url, f"meta/{content_type}/{content_id}.json")


async def fetch_streams(base_url: str, content_type: str, content_id: str) -> dict:
    return await fetch_json(base_url, f"stream/{content_type}/{content_id}.json")


async def fetch_subtitles(base_url: str, content_type: str, content_id: str) -> dict:
    return await fetch_json(base_url, f"subtitles/{content_type}/{content_id}.json")
