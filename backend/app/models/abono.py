import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Dict, Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    func,
)
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.cliente import PointType


class EstadoAbono(str, enum.Enum):
    """Ciclo de conciliación contable del abono."""
    REGISTRADO = "registrado"
    CONCILIADO = "conciliado"
    ANULADO = "anulado"


class Abono(Base):
    """Modelo ORM para la tabla 'abonos' según init.sql."""

    __tablename__ = "abonos"

    id_recibo: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    credito_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("creditos.id_contrato", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    cobrador_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    valor_abonado: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    coordenadas_gps_cobro: Mapped[Optional[Dict[str, float]]] = mapped_column(
        PointType(),
        nullable=True,
    )
    estado: Mapped[EstadoAbono] = mapped_column(
        PG_ENUM(
            EstadoAbono,
            name="estado_abono_enum",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=EstadoAbono.REGISTRADO,
        server_default="registrado",
        nullable=False,
        index=True,
    )
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint("valor_abonado > 0", name="chk_abonos_valor_abonado_pos"),
    )

    # Relaciones ORM
    credito = relationship("Credito", back_populates="abonos", lazy="selectin")
    cobrador = relationship("Usuario", foreign_keys=[cobrador_id], lazy="selectin")

    def __repr__(self) -> str:
        return (
            f"<Abono(id_recibo={self.id_recibo}, credito_id={self.credito_id}, "
            f"valor={self.valor_abonado}, estado='{self.estado}')>"
        )
