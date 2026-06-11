from __future__ import annotations

from datetime import datetime
import json
import random

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .addons import fetch_catalog, fetch_manifest, fetch_meta, fetch_streams, fetch_subtitles, normalize_addon_url
from .config import get_settings
from .db import create_db_and_tables, get_session
from .models import Addon, GuestProfile, PlaybackHistory, SearchLog, User
from .security import create_token, hash_secret, require_actor, require_admin, verify_secret

settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AdminRegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class LoginRequest(BaseModel):
    username: str
    password: str


class GuestLoginRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class GuestCreateRequest(BaseModel):
    display_name: str = Field(default="Gość", max_length=80)
    play_limit: int = Field(default=10, ge=0, le=9999)


class GuestLimitRequest(BaseModel):
    play_limit: int = Field(ge=0, le=9999)


class AddonInstallRequest(BaseModel):
    url: str


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)


class PlaybackStartRequest(BaseModel):
    content_type: str
    content_id: str
    title: str = ""
    season: int | None = None
    episode: int | None = None


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_tables()


def admin_exists(session: Session) -> bool:
    return session.exec(select(User).where(User.role == "admin")).first() is not None


def public_addon(addon: Addon) -> dict:
    manifest = json.loads(addon.manifest_json)
    return {
        "id": addon.id,
        "url": addon.url,
        "manifest_id": addon.manifest_id,
        "name": addon.name,
        "version": addon.version,
        "enabled": addon.enabled,
        "manifest": manifest,
    }


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "app": settings.app_name}


@app.get("/api/bootstrap")
def bootstrap(session: Session = Depends(get_session)) -> dict:
    return {"needs_admin_registration": not admin_exists(session)}


@app.post("/api/auth/register-admin")
def register_admin(payload: AdminRegisterRequest, session: Session = Depends(get_session)) -> dict:
    if admin_exists(session):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Admin already exists")
    user = User(username=payload.username, password_hash=hash_secret(payload.password), role="admin")
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"token": create_token(user.username, "admin", user.id), "user": {"id": user.id, "username": user.username, "role": "admin"}}


@app.post("/api/auth/login")
def login(payload: LoginRequest, session: Session = Depends(get_session)) -> dict:
    user = session.exec(select(User).where(User.username == payload.username)).first()
    if not user or not verify_secret(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return {"token": create_token(user.username, "admin", user.id), "user": {"id": user.id, "username": user.username, "role": "admin"}}


@app.post("/api/auth/guest")
def guest_login(payload: GuestLoginRequest, session: Session = Depends(get_session)) -> dict:
    guests = session.exec(select(GuestProfile).where(GuestProfile.is_active == True)).all()
    guest = next((item for item in guests if verify_secret(payload.code, item.code_hash)), None)
    if not guest:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid guest code")
    remaining = max(0, guest.play_limit - guest.plays_used)
    return {"token": create_token(guest.display_name, "guest", guest.id), "guest": {"id": guest.id, "display_name": guest.display_name, "remaining": remaining, "limit": guest.play_limit}}


@app.get("/api/me")
def me(actor: dict = Depends(require_actor)) -> dict:
    return actor


@app.post("/api/admin/guests")
def create_guest(payload: GuestCreateRequest, _: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    for _attempt in range(20):
        code = "".join(str(random.randint(0, 9)) for _ in range(settings.guest_code_length))
        guest = GuestProfile(code_hash=hash_secret(code), display_name=payload.display_name, play_limit=payload.play_limit)
        session.add(guest)
        session.commit()
        session.refresh(guest)
        return {"id": guest.id, "code": code, "display_name": guest.display_name, "limit": guest.play_limit, "used": guest.plays_used, "active": guest.is_active}
    raise HTTPException(status_code=500, detail="Could not generate guest code")


@app.get("/api/admin/guests")
def list_guests(_: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    guests = session.exec(select(GuestProfile).order_by(GuestProfile.created_at.desc())).all()
    return {"guests": [{"id": g.id, "display_name": g.display_name, "limit": g.play_limit, "used": g.plays_used, "remaining": max(0, g.play_limit - g.plays_used), "active": g.is_active, "created_at": g.created_at.isoformat()} for g in guests]}


@app.patch("/api/admin/guests/{guest_id}/limit")
def update_guest_limit(guest_id: int, payload: GuestLimitRequest, _: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    guest = session.get(GuestProfile, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    guest.play_limit = payload.play_limit
    session.add(guest)
    session.commit()
    return {"ok": True}


@app.patch("/api/admin/guests/{guest_id}/toggle")
def toggle_guest(guest_id: int, _: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    guest = session.get(GuestProfile, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    guest.is_active = not guest.is_active
    session.add(guest)
    session.commit()
    return {"ok": True, "active": guest.is_active}


@app.delete("/api/admin/guests/{guest_id}")
def delete_guest(guest_id: int, _: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    guest = session.get(GuestProfile, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    session.delete(guest)
    session.commit()
    return {"ok": True}


@app.post("/api/admin/addons")
async def install_addon(payload: AddonInstallRequest, _: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    url = normalize_addon_url(payload.url)
    manifest = await fetch_manifest(url)
    existing = session.exec(select(Addon).where(Addon.url == url)).first()
    addon = existing or Addon(url=url, manifest_id=manifest["id"], name=manifest["name"], manifest_json="{}")
    addon.manifest_id = manifest["id"]
    addon.name = manifest["name"]
    addon.version = str(manifest.get("version", "unknown"))
    addon.manifest_json = json.dumps(manifest)
    addon.updated_at = datetime.utcnow()
    session.add(addon)
    session.commit()
    session.refresh(addon)
    return public_addon(addon)


@app.get("/api/addons")
def list_addons(actor: dict = Depends(require_actor), session: Session = Depends(get_session)) -> dict:
    addons = session.exec(select(Addon).where(Addon.enabled == True)).all()
    return {"addons": [public_addon(addon) for addon in addons]}


@app.get("/api/catalogs")
async def catalogs(actor: dict = Depends(require_actor), session: Session = Depends(get_session)) -> dict:
    addons = session.exec(select(Addon).where(Addon.enabled == True)).all()
    libraries: list[dict] = []
    for addon in addons:
        manifest = json.loads(addon.manifest_json)
        for catalog in manifest.get("catalogs", []):
            try:
                data = await fetch_catalog(addon.url, catalog.get("type", "movie"), catalog.get("id"))
                libraries.append({"addon": addon.name, "catalog": catalog, "items": data.get("metas", [])})
            except Exception as exc:
                libraries.append({"addon": addon.name, "catalog": catalog, "items": [], "error": str(exc)})
    return {"libraries": libraries}


@app.post("/api/search")
async def search(payload: SearchRequest, actor: dict = Depends(require_actor), session: Session = Depends(get_session)) -> dict:
    session.add(SearchLog(actor_type=actor["role"], actor_id=actor["id"], query=payload.query))
    session.commit()
    addons = session.exec(select(Addon).where(Addon.enabled == True)).all()
    results: list[dict] = []
    needle = payload.query.lower()
    for addon in addons:
        manifest = json.loads(addon.manifest_json)
        for catalog in manifest.get("catalogs", []):
            try:
                data = await fetch_catalog(addon.url, catalog.get("type", "movie"), catalog.get("id"))
                for item in data.get("metas", []):
                    if needle in str(item.get("name", "")).lower() or needle in str(item.get("description", "")).lower():
                        results.append({**item, "addon": addon.name, "type": catalog.get("type", "movie")})
            except Exception:
                continue
    return {"results": results}


@app.get("/api/meta/{content_type}/{content_id}")
async def meta(content_type: str, content_id: str, actor: dict = Depends(require_actor), session: Session = Depends(get_session)) -> dict:
    addons = session.exec(select(Addon).where(Addon.enabled == True)).all()
    errors: list[str] = []
    for addon in addons:
        try:
            data = await fetch_meta(addon.url, content_type, content_id)
            if data.get("meta"):
                return {"addon": addon.name, "meta": data["meta"]}
        except Exception as exc:
            errors.append(f"{addon.name}: {exc}")
    raise HTTPException(status_code=404, detail={"message": "Meta not found", "errors": errors})


@app.get("/api/streams/{content_type}/{content_id}")
async def streams(content_type: str, content_id: str, actor: dict = Depends(require_actor), session: Session = Depends(get_session)) -> dict:
    addons = session.exec(select(Addon).where(Addon.enabled == True)).all()
    streams_list: list[dict] = []
    for addon in addons:
        try:
            data = await fetch_streams(addon.url, content_type, content_id)
            for stream in data.get("streams", []):
                streams_list.append({**stream, "addon": addon.name})
        except Exception:
            continue
    return {"streams": streams_list}


@app.get("/api/subtitles/{content_type}/{content_id}")
async def subtitles(content_type: str, content_id: str, actor: dict = Depends(require_actor), session: Session = Depends(get_session)) -> dict:
    addons = session.exec(select(Addon).where(Addon.enabled == True)).all()
    subtitle_list: list[dict] = []
    for addon in addons:
        try:
            data = await fetch_subtitles(addon.url, content_type, content_id)
            for subtitle in data.get("subtitles", []):
                subtitle_list.append({**subtitle, "addon": addon.name})
        except Exception:
            continue
    return {"subtitles": subtitle_list}


@app.post("/api/playback/start")
def playback_start(payload: PlaybackStartRequest, actor: dict = Depends(require_actor), session: Session = Depends(get_session)) -> dict:
    if actor["role"] == "guest":
        guest = session.get(GuestProfile, actor["id"])
        if not guest or not guest.is_active:
            raise HTTPException(status_code=401, detail="Guest inactive")
        if guest.plays_used >= guest.play_limit:
            raise HTTPException(status_code=403, detail="Playback limit reached")
        guest.plays_used += 1
        session.add(guest)
    history = PlaybackHistory(actor_type=actor["role"], actor_id=actor["id"], content_type=payload.content_type, content_id=payload.content_id, title=payload.title, season=payload.season, episode=payload.episode)
    session.add(history)
    session.commit()
    remaining = None
    if actor["role"] == "guest":
        guest = session.get(GuestProfile, actor["id"])
        remaining = max(0, guest.play_limit - guest.plays_used)
    return {"ok": True, "remaining": remaining}


@app.get("/api/admin/logs/searches")
def search_logs(_: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    logs = session.exec(select(SearchLog).order_by(SearchLog.created_at.desc()).limit(100)).all()
    return {"logs": [{"id": log.id, "actor_type": log.actor_type, "actor_id": log.actor_id, "query": log.query, "created_at": log.created_at.isoformat()} for log in logs]}
