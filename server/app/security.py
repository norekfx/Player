from datetime import datetime, timedelta, timezone
from typing import Any
import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select
from .config import get_settings
from .db import get_session
from .models import GuestProfile, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


def hash_secret(value: str) -> str:
    return pwd_context.hash(value)


def verify_secret(value: str, hashed: str) -> bool:
    return pwd_context.verify(value, hashed)


def create_token(subject: str, role: str, actor_id: int, expires_hours: int = 24 * 14) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "actor_id": actor_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=expires_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.app_secret, algorithm="HS256")


def decode_token(credentials: HTTPAuthorizationCredentials | None) -> dict[str, Any]:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    try:
        return jwt.decode(credentials.credentials, get_settings().app_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    payload = decode_token(credentials)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    user = session.get(User, payload.get("actor_id"))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin not found")
    return user


def require_actor(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    payload = decode_token(credentials)
    role = payload.get("role")
    actor_id = payload.get("actor_id")
    if role == "admin":
        user = session.get(User, actor_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin not found")
        return {"role": "admin", "id": user.id, "username": user.username}
    if role == "guest":
        guest = session.get(GuestProfile, actor_id)
        if not guest or not guest.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Guest inactive")
        return {"role": "guest", "id": guest.id, "display_name": guest.display_name, "remaining": guest.play_limit - guest.plays_used, "limit": guest.play_limit}
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid actor")
