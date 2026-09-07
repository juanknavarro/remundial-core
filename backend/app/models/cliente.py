import enum
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import UserDefinedType

from app.core.database import Base


class TipoReferenciaEnum(str, enum.Enum):
    """Tipos de contacto de respaldo del cliente."""
    FAMILIAR = "familiar"
    CODEUDOR = "codeudor"


class PointType(UserDefinedType):
    """Mapeador para el tipo nativo POINT de PostgreSQL.

    Convención geográfica: POINT(longitud, latitud) -> (X, Y).
    Compatible con asyncpg (requiere tupla de floats o asyncpg.Point),
    diccionarios de coordenadas y esquemas Pydantic.
    """

    def get_col_spec(self, **kw) -> str:
        return "POINT"

    def bind_processor(self, dialect):
        def process(value: Any) -> Optional[Tuple[float, float]]:
            if value is None:
                return None
            # Convierte diccionarios {"longitud": x, "latitud": y}
            if isinstance(value, dict):
                lon = value.get("longitud")
                lat = value.get("latitud")
                if lon is not None and lat is not None:
                    return (float(lon), float(lat))
            # Tuplas o listas
            if isinstance(value, (tuple, list)) and len(value) == 2:
                return (float(value[0]), float(value[1]))
            # Objetos Pydantic o similares con atributos
            if hasattr(value, "longitud") and hasattr(value, "latitud"):
                return (float(value.longitud), float(value.latitud))
            # Cadenas en formato "(x, y)"
            if isinstance(value, str):
                match = re.match(r"^\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$", value)
                if match:
                    return (float(match.group(1)), float(match.group(2)))
            return value

        return process

    def result_processor(self, dialect, coltype):
        def process(value: Any) -> Optional[Dict[str, float]]:
            if value is None:
                return None
            # asyncpg retorna instancias de asyncpg.Point con propiedades x e y
            if hasattr(value, "x") and hasattr(value, "y"):
                return {"longitud": float(value.x), "latitud": float(value.y)}
            if isinstance(value, (tuple, list)) and len(value) == 2:
                return {"longitud": float(value[0]), "latitud": float(value[1])}
            if isinstance(value, dict):
                return {
                    "longitud": float(value.get("longitud", 0.0)),
                    "latitud": float(value.get("latitud", 0.0)),
                }
            if isinstance(value, str):
                match = re.match(r"^\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$", value)
                if match:
                    return {"longitud": float(match.group(1)), "latitud": float(match.group(2))}
            return None

        return process


class Cliente(Base):
    """Modelo ORM para la tabla 'clientes' según init.sql."""

    __tablename__ = "clientes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    cedula: Mapped[str] = mapped_column(
        String(30),
        unique=True,
        nullable=False,
        index=True,
    )
    nombres: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )
    telefono: Mapped[Optional[str]] = mapped_column(
        String(25),
        nullable=True,
    )
    direccion: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    barrio: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    ciudad: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    coordenadas_gps: Mapped[Optional[Dict[str, float]]] = mapped_column(
        PointType(),
        nullable=True,
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

    # Relaciones ORM
    referencias: Mapped[List["ReferenciaCliente"]] = relationship(
        "ReferenciaCliente",
        back_populates="cliente",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return (
            f"<Cliente(id={self.id}, cedula='{self.cedula}', "
            f"nombres='{self.nombres}', ciudad='{self.ciudad}')>"
        )


class ReferenciaCliente(Base):
    """Modelo ORM para la tabla 'referencias_cliente' (codeudores y referencias familiares)."""

    __tablename__ = "referencias_cliente"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    cliente_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clientes.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    tipo: Mapped[TipoReferenciaEnum] = mapped_column(
        PG_ENUM(
            TipoReferenciaEnum,
            name="tipo_referencia_enum",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    nombre: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )
    cedula: Mapped[Optional[str]] = mapped_column(
        String(30),
        nullable=True,
    )
    telefono: Mapped[Optional[str]] = mapped_column(
        String(25),
        nullable=True,
    )
    direccion: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relaciones ORM
    cliente: Mapped["Cliente"] = relationship("Cliente", back_populates="referencias")

    def __repr__(self) -> str:
        return (
            f"<ReferenciaCliente(id={self.id}, tipo='{self.tipo}', "
            f"nombre='{self.nombre}', cliente_id={self.cliente_id})>"
        )
