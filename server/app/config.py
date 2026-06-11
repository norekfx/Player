from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Player"
    app_secret: str = "change-me"
    database_url: str = "sqlite:////data/player.db"
    cors_origins: str = "http://localhost:8080,http://localhost:5173"
    intro_db_refresh_hours: int = 24
    guest_code_length: int = 6
    default_guest_play_limit: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
