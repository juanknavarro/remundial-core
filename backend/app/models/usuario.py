import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RolUsuario(str, enum.Enum):
    """Roles disponibles para los usuarios del sistema."""
    MASTER = "master"
    SUPERVISOR = "supervisor"
    SECRETARIA = "secretaria"
    VENDEDOR = "vendedor"
    COBRADOR = "cobrador"


class Usuario(Base):
    """Modelo ORM para la tabla 'usuarios' según init.sql y migraciones."""

    __tablename__ = "usuarios"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    nombre: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )
    rol: Mapped[RolUsuario] = mapped_column(
        PG_ENUM(
            RolUsuario,
            name="rol_usuario_enum",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    telefono: Mapped[Optional[str]] = mapped_column(
        String(25),
        nullable=True,
        index=True,
    )
    estado_activo: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default="true",
        nullable=False,
    )
    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        default="generico",
        server_default="generico",
    )
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Usuario(id={self.id}, nombre='{self.nombre}', rol='{self.rol}')>"
