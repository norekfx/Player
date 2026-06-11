from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    role: str = Field(default="admin", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GuestProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code_hash: str = Field(index=True, unique=True)
    display_name: str
    play_limit: int = 10
    plays_used: int = 0
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None


class Addon(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    url: str = Field(index=True, unique=True)
    manifest_id: str = Field(index=True)
    name: str
    version: str = "unknown"
    manifest_json: str
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SearchLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    actor_type: str = Field(index=True)
    actor_id: Optional[int] = Field(default=None, index=True)
    query: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PlaybackHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    actor_type: str = Field(index=True)
    actor_id: Optional[int] = Field(default=None, index=True)
    content_type: str
    content_id: str
    title: str = ""
    season: Optional[int] = None
    episode: Optional[int] = None
    position_seconds: int = 0
    duration_seconds: int = 0
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AppSetting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)
