from __future__ import annotations

from html import unescape
from urllib.parse import urlparse
import gzip
import io
import re
import zipfile

import httpx

from .addons import AddonError, fetch_json, safe_path_part

def normalize_newlines(text: str) -> str:
    return text.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")


def strip_subtitle_tags(text: str) -> str:
    text = re.sub(r"\{\\[^}]*\}", "", text)
    text = text.replace("\\N", "\n").replace("\\n", "\n")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(text).strip()


def parse_timecode(value: str) -> float:
    value = value.strip().replace(",", ".")
    match = re.match(r"(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?", value)
    if not match:
        return 0.0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    millis = (match.group(4) or "0").ljust(3, "0")[:3]
    return hours * 3600 + minutes * 60 + seconds + int(millis) / 1000


def cue(start: float, end: float, text: str) -> dict | None:
    clean = strip_subtitle_tags(text)
    if not clean or end <= start:
        return None
    return {"start": round(float(start), 3), "end": round(float(end), 3), "text": clean}


def parse_srt_or_vtt(text: str) -> list[dict]:
    body = normalize_newlines(text)
    body = re.sub(r"^WEBVTT[^\n]*(?:\n|$)", "", body, flags=re.I).strip()
    cues: list[dict] = []
    for block in re.split(r"\n\s*\n", body):
        lines = [line.strip("\ufeff") for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        time_index = next((i for i, line in enumerate(lines) if "-->" in line), -1)
        if time_index < 0:
            continue
        start_raw, end_raw = lines[time_index].split("-->", 1)
        item = cue(parse_timecode(start_raw.split()[0]), parse_timecode(end_raw.split()[0]), "\n".join(lines[time_index + 1 :]))
        if item:
            cues.append(item)
    return cues


def parse_ass_or_ssa(text: str) -> list[dict]:
    lines = normalize_newlines(text).split("\n")
    in_events = False
    fields: list[str] = []
    cues: list[dict] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith(";"):
            continue
        if line.lower() == "[events]":
            in_events = True
            continue
        if line.startswith("[") and line.endswith("]"):
            in_events = False
            continue
        if not in_events:
            continue
        if line.lower().startswith("format:"):
            fields = [field.strip().lower() for field in line.split(":", 1)[1].split(",")]
            continue
        if line.lower().startswith(("dialogue:", "comment:")):
            if not fields:
                fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
            payload = line.split(":", 1)[1].lstrip()
            parts = payload.split(",", max(0, len(fields) - 1))
            if len(parts) < len(fields):
                continue
            data = {fields[i]: parts[i].strip() for i in range(len(fields))}
            item = cue(parse_timecode(data.get("start", "")), parse_timecode(data.get("end", "")), data.get("text", ""))
            if item:
                cues.append(item)
    return cues


def parse_microdvd(text: str, fps: float = 23.976) -> list[dict]:
    cues: list[dict] = []
    for start, end, body in re.findall(r"\{(\d+)\}\{(\d+)\}([^\n]+)", normalize_newlines(text)):
        item = cue(int(start) / fps, int(end) / fps, body.replace("|", "\n"))
        if item:
            cues.append(item)
    return cues


def parse_mpl2(text: str) -> list[dict]:
    cues: list[dict] = []
    for start, end, body in re.findall(r"\[(\d+)\]\[(\d+)\]([^\n]+)", normalize_newlines(text)):
        item = cue(int(start) / 10, int(end) / 10, body.replace("|", "\n"))
        if item:
            cues.append(item)
    return cues


def parse_sami(text: str) -> list[dict]:
    body = normalize_newlines(text)
    matches = list(re.finditer(r"<sync\s+start\s*=\s*['\"]?(\d+)['\"]?[^>]*>(.*?)(?=<sync\s+start\s*=|</body>|</sami>|$)", body, flags=re.I | re.S))
    cues: list[dict] = []
    for index, match in enumerate(matches):
        start = int(match.group(1)) / 1000
        end = int(matches[index + 1].group(1)) / 1000 if index + 1 < len(matches) else start + 4
        item = cue(start, end, match.group(2))
        if item:
            cues.append(item)
    return cues


def parse_ttml(text: str) -> list[dict]:
    cues: list[dict] = []
    for match in re.finditer(r"<p\b[^>]*\bbegin=['\"]([^'\"]+)['\"][^>]*\bend=['\"]([^'\"]+)['\"][^>]*>(.*?)</p>", normalize_newlines(text), flags=re.I | re.S):
        item = cue(parse_timecode(match.group(1)), parse_timecode(match.group(2)), match.group(3))
        if item:
            cues.append(item)
    return cues


def detect_subtitle_format(text: str, url: str = "", content_type: str = "") -> str:
    lowered = " ".join([urlparse(url).path.lower(), content_type.lower()])
    for ext in ("vtt", "srt", "ass", "ssa", "smi", "sami", "ttml", "dfxp", "mpl2", "sub"):
        if re.search(rf"\.{ext}(?:$|\b)", lowered):
            return "sami" if ext == "smi" else ext
    sample = normalize_newlines(text).lstrip()[:800].lower()
    if sample.startswith("webvtt"):
        return "vtt"
    if "[script info]" in sample or "[events]" in sample or "dialogue:" in sample:
        return "ass"
    if "<sami" in sample or "<sync" in sample:
        return "sami"
    if "<tt" in sample or "<p begin=" in sample:
        return "ttml"
    if re.search(r"\{\d+\}\{\d+\}", sample):
        return "sub"
    if re.search(r"\[\d+\]\[\d+\]", sample):
        return "mpl2"
    if "-->" in sample:
        return "srt"
    return "unknown"


def parse_subtitle_text(text: str, fmt: str) -> list[dict]:
    if fmt in {"srt", "vtt", "unknown"}:
        cues = parse_srt_or_vtt(text)
        if cues:
            return cues
    if fmt in {"ass", "ssa", "unknown"}:
        cues = parse_ass_or_ssa(text)
        if cues:
            return cues
    if fmt in {"sami", "unknown"}:
        cues = parse_sami(text)
        if cues:
            return cues
    if fmt in {"ttml", "dfxp", "unknown"}:
        cues = parse_ttml(text)
        if cues:
            return cues
    if fmt in {"mpl2", "unknown"}:
        cues = parse_mpl2(text)
        if cues:
            return cues
    if fmt in {"sub", "unknown"}:
        cues = parse_microdvd(text)
        if cues:
            return cues
    return []


def format_timestamp(seconds: float) -> str:
    millis_total = int(round(seconds * 1000))
    millis = millis_total % 1000
    total_seconds = millis_total // 1000
    second = total_seconds % 60
    minute = (total_seconds // 60) % 60
    hour = total_seconds // 3600
    return f"{hour:02}:{minute:02}:{second:02}.{millis:03}"


def cues_to_vtt(cues: list[dict]) -> str:
    lines = ["WEBVTT", ""]
    for index, item in enumerate(cues, start=1):
        lines.append(str(index))
        lines.append(f"{format_timestamp(item['start'])} --> {format_timestamp(item['end'])}")
        lines.append(str(item["text"]))
        lines.append("")
    return "\n".join(lines)


def decode_subtitle_bytes(data: bytes, url: str = "") -> tuple[str, str, str]:
    archive_note = ""
    if data.startswith(b"\x1f\x8b") or url.lower().endswith(".gz"):
        data = gzip.decompress(data)
        archive_note = "gz"
    elif data.startswith(b"PK\x03\x04") or url.lower().endswith(".zip"):
        archive_note = "zip"
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            candidates = [name for name in archive.namelist() if not name.endswith("/")]
            subtitle_names = [name for name in candidates if re.search(r"\.(srt|vtt|ass|ssa|smi|sami|ttml|dfxp|mpl2|sub)$", name, re.I)]
            if not subtitle_names:
                raise AddonError("Archiwum z napisami nie zawiera obsługiwanego pliku tekstowego.")
            data = archive.read(subtitle_names[0])
            url = subtitle_names[0]
    encodings = ["utf-8-sig", "utf-8", "cp1250", "iso-8859-2", "windows-1252", "latin-1"]
    for encoding in encodings:
        try:
            return data.decode(encoding), encoding, archive_note
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8-replace", archive_note


async def normalize_subtitle_item(client: httpx.AsyncClient, subtitle: dict) -> dict:
    normalized = dict(subtitle)
    raw_url = normalized.get("url") or normalized.get("file")
    if not raw_url:
        normalized.update({"status": "error", "error": "Brak adresu pliku napisów.", "format": "unknown", "cues": []})
        return normalized
    try:
        response = await client.get(raw_url, headers={"Accept": "text/vtt,text/plain,*/*"})
        response.raise_for_status()
        text, encoding, archive = decode_subtitle_bytes(response.content, raw_url)
        fmt = detect_subtitle_format(text, raw_url, response.headers.get("content-type", ""))
        cues = parse_subtitle_text(text, fmt)
        if not cues:
            raise AddonError(f"Nieobsługiwany albo pusty format napisów: {fmt}")
        normalized.update({
            "status": "ready",
            "format": fmt,
            "encoding": encoding,
            "archive": archive,
            "cues": cues,
            "cue_count": len(cues),
            "vtt": cues_to_vtt(cues),
        })
    except Exception as exc:
        fmt = detect_subtitle_format("", raw_url, "")
        normalized.update({"status": "error", "format": fmt, "error": str(exc), "cues": [], "cue_count": 0})
    return normalized


async def fetch_subtitles(base_url: str, content_type: str, content_id: str) -> dict:
    data = await fetch_json(base_url, f"subtitles/{safe_path_part(content_type)}/{safe_path_part(content_id)}.json", timeout_seconds=30)
    subtitles = [item for item in data.get("subtitles", []) if isinstance(item, dict)]
    timeout = httpx.Timeout(20, connect=10)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        data["subtitles"] = [await normalize_subtitle_item(client, item) for item in subtitles]
    return data
