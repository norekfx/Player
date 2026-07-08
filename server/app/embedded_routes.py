from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any

from fastapi import Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlmodel import Session

from .db import get_session
from .models import User
from .security import require_actor, require_admin
from .subtitle_normalizer import cues_to_vtt, detect_subtitle_format, parse_subtitle_text

EMBEDDED_SUBTITLE_SETTING_KEY = "embedded_subtitles_mode"
EMBEDDED_SUBTITLE_DEFAULT_MODE = "auto"
EMBEDDED_SUBTITLE_MODES = {"off", "on", "auto"}
TEXT_SUBTITLE_CODECS = {"subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"}
IMAGE_SUBTITLE_CODECS = {"hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub", "dvb_teletext"}
CACHE_TTL_SECONDS = 60 * 60
FFPROBE_TIMEOUT_SECONDS = 12
FFMPEG_TIMEOUT_SECONDS = 25
MAX_SUBTITLE_BYTES = 4 * 1024 * 1024

_probe_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_extract_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class EmbeddedSubtitleSettingsRequest(BaseModel):
    mode: str = EMBEDDED_SUBTITLE_DEFAULT_MODE


def normalize_mode(value: str | None) -> str:
    mode = str(value or EMBEDDED_SUBTITLE_DEFAULT_MODE).strip().lower()
    return mode if mode in EMBEDDED_SUBTITLE_MODES else EMBEDDED_SUBTITLE_DEFAULT_MODE


def cache_get(cache: dict[str, tuple[float, dict[str, Any]]], key: str) -> dict[str, Any] | None:
    item = cache.get(key)
    if not item:
        return None
    created_at, value = item
    if time.time() - created_at > CACHE_TTL_SECONDS:
        cache.pop(key, None)
        return None
    return value


def cache_set(cache: dict[str, tuple[float, dict[str, Any]]], key: str, value: dict[str, Any]) -> dict[str, Any]:
    cache[key] = (time.time(), value)
    return value


def url_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8", errors="ignore")).hexdigest()


def is_polish(value: str | None) -> bool:
    text = str(value or "").strip().lower()
    return text in {"pl", "pol", "polish", "polski"} or any(word in text for word in ("polish", "polski", "pol ", " pl"))


def language_name(value: str | None) -> str:
    text = str(value or "").strip().lower()
    return {"pl": "Polski", "pol": "Polski", "polish": "Polski", "polski": "Polski", "en": "Angielski", "eng": "Angielski"}.get(text, value or "Nieznany")


def subtitle_kind(codec: str) -> str:
    codec = codec.lower()
    if codec in TEXT_SUBTITLE_CODECS:
        return "text"
    if codec in IMAGE_SUBTITLE_CODECS:
        return "image"
    return "unknown"


def ffmpeg_format_for_codec(codec: str) -> str:
    codec = codec.lower()
    if codec in {"ass", "ssa"}:
        return "ass"
    if codec == "webvtt":
        return "webvtt"
    return "srt"


async def run_process(args: list[str], timeout_seconds: int, max_stdout_bytes: int | None = None) -> bytes:
    try:
        proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Brak programu {args[0]} w kontenerze/serwerze.") from exc

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        proc.kill()
        await proc.communicate()
        raise HTTPException(status_code=504, detail=f"{args[0]} przekroczył limit czasu {timeout_seconds}s.") from exc

    if proc.returncode != 0:
        message = stderr.decode("utf-8", errors="replace").strip() or f"{args[0]} zakończył się kodem {proc.returncode}."
        raise HTTPException(status_code=502, detail=message[:500])
    if max_stdout_bytes is not None and len(stdout) > max_stdout_bytes:
        raise HTTPException(status_code=413, detail="Napisy osadzone są zbyt duże do bezpiecznego przetworzenia.")
    return stdout


def normalize_track(stream: dict[str, Any]) -> dict[str, Any] | None:
    if stream.get("codec_type") != "subtitle":
        return None
    codec = str(stream.get("codec_name") or "unknown").lower()
    tags = stream.get("tags") or {}
    language = str(tags.get("language") or stream.get("language") or "").strip()
    title = str(tags.get("title") or stream.get("title") or "").strip()
    disposition = stream.get("disposition") or {}
    index = int(stream.get("index", -1))
    kind = subtitle_kind(codec)
    label = title or language_name(language) or f"Ścieżka {index}"
    text = f"{language} {title} {label}"
    return {
        "index": index,
        "codec": codec,
        "kind": kind,
        "language": language,
        "title": title,
        "label": label,
        "polish": is_polish(language) or is_polish(title) or is_polish(label) or "polski" in text.lower() or "polish" in text.lower(),
        "extractable": kind == "text",
        "burnable": kind == "image",
        "default": bool(disposition.get("default")),
        "forced": bool(disposition.get("forced")),
        "status": "extractable" if kind == "text" else "burnable" if kind == "image" else "unsupported",
    }


async def probe_embedded_subtitles(url: str) -> dict[str, Any]:
    key = url_key(url)
    cached = cache_get(_probe_cache, key)
    if cached:
        return cached
    payload = await run_process([
        "ffprobe", "-v", "error", "-print_format", "json", "-show_streams", url,
    ], timeout_seconds=FFPROBE_TIMEOUT_SECONDS, max_stdout_bytes=2 * 1024 * 1024)
    try:
        data = json.loads(payload.decode("utf-8", errors="replace") or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="ffprobe nie zwrócił poprawnego JSON.") from exc
    tracks = [track for track in (normalize_track(stream) for stream in data.get("streams", [])) if track]
    result = {"tracks": tracks, "text_tracks": [t for t in tracks if t["extractable"]], "polish_tracks": [t for t in tracks if t["polish"]]}
    return cache_set(_probe_cache, key, result)


async def extract_embedded_subtitle(url: str, stream_index: int, codec: str) -> dict[str, Any]:
    cache_key = f"{url_key(url)}:{stream_index}"
    cached = cache_get(_extract_cache, cache_key)
    if cached:
        return cached

    formats = [ffmpeg_format_for_codec(codec), "srt", "ass", "webvtt"]
    seen_formats: set[str] = set()
    last_error: HTTPException | None = None
    for fmt in formats:
        if fmt in seen_formats:
            continue
        seen_formats.add(fmt)
        try:
            payload = await run_process([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", url,
                "-map", f"0:{stream_index}", "-f", fmt, "-",
            ], timeout_seconds=FFMPEG_TIMEOUT_SECONDS, max_stdout_bytes=MAX_SUBTITLE_BYTES)
            text = payload.decode("utf-8-sig", errors="replace")
            detected = detect_subtitle_format(text, f"embedded.{fmt}", "")
            cues = parse_subtitle_text(text, detected)
            if not cues:
                continue
            result = {
                "status": "ready",
                "source": "embedded-ffmpeg",
                "format": detected,
                "ffmpeg_format": fmt,
                "stream_index": stream_index,
                "codec": codec,
                "cues": cues,
                "cue_count": len(cues),
                "vtt": cues_to_vtt(cues),
            }
            return cache_set(_extract_cache, cache_key, result)
        except HTTPException as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise HTTPException(status_code=422, detail="Nie udało się wyciągnąć tekstowych napisów z wybranej ścieżki.")


def route_exists(app, path: str) -> bool:
    return any(getattr(route, "path", "") == path for route in app.routes)


def register_embedded_routes(app) -> None:
    if route_exists(app, "/api/embedded-subtitles/scan"):
        return

    from .main import get_setting, set_setting

    def mode_from_db(session: Session) -> str:
        return normalize_mode(get_setting(session, EMBEDDED_SUBTITLE_SETTING_KEY, EMBEDDED_SUBTITLE_DEFAULT_MODE))

    @app.get("/api/embedded-subtitles/settings")
    def embedded_subtitle_settings(actor: dict = Depends(require_actor), session: Session = Depends(get_session)) -> dict:
        return {"mode": mode_from_db(session), "modes": ["off", "auto", "on"]}

    @app.put("/api/admin/embedded-subtitles/settings")
    def update_embedded_subtitle_settings(payload: EmbeddedSubtitleSettingsRequest, _: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
        mode = normalize_mode(payload.mode)
        set_setting(session, EMBEDDED_SUBTITLE_SETTING_KEY, mode)
        return {"ok": True, "mode": mode, "modes": ["off", "auto", "on"]}

    @app.get("/api/embedded-subtitles/scan")
    async def scan_embedded_subtitles(
        url: str = Query(...),
        has_polish_addon: bool = Query(False),
        has_polish_native: bool = Query(False),
        actor: dict = Depends(require_actor),
        session: Session = Depends(get_session),
    ) -> dict:
        mode = mode_from_db(session)
        if mode == "off":
            return {"mode": mode, "enabled": False, "skipped": True, "reason": "disabled", "tracks": []}
        if mode == "auto" and (has_polish_addon or has_polish_native):
            return {"mode": mode, "enabled": True, "skipped": True, "reason": "polish_subtitles_already_available", "tracks": []}
        result = await probe_embedded_subtitles(url)
        return {"mode": mode, "enabled": True, "skipped": False, "tracks": result["tracks"]}

    @app.get("/api/embedded-subtitles/extract")
    async def extract_embedded_subtitles(
        url: str = Query(...),
        stream_index: int = Query(..., ge=0),
        actor: dict = Depends(require_actor),
        session: Session = Depends(get_session),
    ) -> Response:
        mode = mode_from_db(session)
        if mode == "off":
            raise HTTPException(status_code=403, detail="Obsługa napisów osadzonych przez FFmpeg jest wyłączona w ustawieniach administratora.")
        probe = await probe_embedded_subtitles(url)
        track = next((item for item in probe["tracks"] if item["index"] == stream_index), None)
        if not track:
            raise HTTPException(status_code=404, detail="Nie znaleziono tej ścieżki napisów w filmie.")
        if not track.get("extractable"):
            raise HTTPException(status_code=422, detail="Ta ścieżka napisów jest obrazkowa albo nieobsługiwana. Etap 2 obsługuje tylko tekstowe embedded subtitles.")
        data = await extract_embedded_subtitle(url, stream_index, track["codec"])
        data.update({"language": track.get("language"), "label": track.get("label"), "title": track.get("title"), "polish": track.get("polish")})
        return Response(content=json.dumps(data), media_type="application/json")
