import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Dict, Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
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
    cierre_caja_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cierres_caja.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    metodo_pago: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        default="efectivo",
        server_default="efectivo",
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
    cierre_caja = relationship("CierreCaja", back_populates="abonos", lazy="selectin")

    def __repr__(self) -> str:
        return (
            f"<Abono(id_recibo={self.id_recibo}, credito_id={self.credito_id}, "
            f"valor={self.valor_abonado}, estado='{self.estado}')>"
        )


class CierreCaja(Base):
    """Modelo ORM para la auditoría y actas de cierre de caja por ruta/cobrador."""

    __tablename__ = "cierres_caja"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    cobrador_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    responsable_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    fecha_cierre: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    total_esperado: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    efectivo_entregado: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    diferencia: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    cuadre_estado: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True,
    )
    abonos_conciliados_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    notas: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relaciones ORM
    cobrador = relationship("Usuario", foreign_keys=[cobrador_id], lazy="selectin")
    responsable = relationship("Usuario", foreign_keys=[responsable_id], lazy="selectin")
    abonos = relationship("Abono", back_populates="cierre_caja", lazy="selectin")

    def __repr__(self) -> str:
        return (
            f"<CierreCaja(id={self.id}, cobrador_id={self.cobrador_id}, "
            f"esperado={self.total_esperado}, entregado={self.efectivo_entregado}, "
            f"estado='{self.cuadre_estado}')>"
        )

