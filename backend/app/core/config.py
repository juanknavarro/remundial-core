from typing import Optional
from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración global de la aplicación usando variables de entorno."""

    PROJECT_NAME: str = "Remundial Core API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Credenciales de conexión a PostgreSQL
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "remundial_db"

    # URL completa opcional (si se define, toma precedencia sobre las partes individuales)
    DATABASE_URL: Optional[str] = None

    # Configuración de Seguridad y JWT
    SECRET_KEY: str = "remundial_super_secret_jwt_key_production_2026_secure_32bytes"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 horas para uso en campo

    @computed_field
    @property
    def async_database_url(self) -> str:
        """Construye y valida la URL asíncrona para SQLAlchemy (driver asyncpg)."""
        if self.DATABASE_URL:
            # Asegurar prefijo asíncrono para asyncpg
            if self.DATABASE_URL.startswith("postgresql://"):
                return self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
            return self.DATABASE_URL

        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@"
            f"{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
