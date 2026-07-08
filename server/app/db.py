from sqlmodel import SQLModel, Session, create_engine
from .config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
_embedded_routes_registered = False


def create_db_and_tables() -> None:
    global _embedded_routes_registered
    SQLModel.metadata.create_all(engine)
    if not _embedded_routes_registered:
        from .embedded_routes import register_embedded_routes
        from .main import app
        register_embedded_routes(app)
        _embedded_routes_registered = True


def get_session():
    with Session(engine) as session:
        yield session
