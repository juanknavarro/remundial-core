import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EstadoDevolucion(str, enum.Enum):
    """Estados del ciclo de vida de una devolución/anulación de venta."""
    EFECTIVO_DEVUELTO_EN_RUTA = "EFECTIVO_DEVUELTO_EN_RUTA"
    PENDIENTE_REEMBOLSO_TRANSFERENCIA = "PENDIENTE_REEMBOLSO_TRANSFERENCIA"
    REEMBOLSADO_OFICINA = "REEMBOLSADO_OFICINA"


class VentaAnulada(Base):
    """Modelo ORM para la tabla 'ventas_anuladas'."""

    __tablename__ = "ventas_anuladas"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    vendedor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    monto_total: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    metodo_pago_original: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )
    referencia_original: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    articulos_json: Mapped[Any] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default="'[]'::jsonb",
    )
    estado_devolucion: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default=EstadoDevolucion.PENDIENTE_REEMBOLSO_TRANSFERENCIA.value,
        index=True,
    )
    banco_destino_cliente: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    cuenta_destino_cliente: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    notas_vendedor: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    referencia_reembolso_oficina: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    banco_origen_reembolso: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    fecha_reembolso: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    firma_vendedor: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    firma_cliente: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relación con el vendedor para join automático
    vendedor = relationship("Usuario", foreign_keys=[vendedor_id], lazy="joined")

    def __repr__(self) -> str:
        return f"<VentaAnulada(id={self.id}, monto={self.monto_total}, estado='{self.estado_devolucion}')>"
