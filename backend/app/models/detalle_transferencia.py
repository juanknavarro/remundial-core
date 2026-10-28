import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class DetalleTransferencia(Base):
    """Modelo ORM para almacenar múltiples transferencias bancarias asociadas a una venta o abono."""

    __tablename__ = "detalles_transferencia"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    venta_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("creditos.id_contrato", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    abono_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("abonos.id_recibo", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    entidad_bancaria: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    referencia_pago: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    monto: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint("monto > 0", name="chk_detalles_transferencia_monto_pos"),
    )

    # Relaciones ORM
    venta = relationship("Credito", back_populates="transferencias")
    abono = relationship("Abono", back_populates="transferencias")

    def __repr__(self) -> str:
        return (
            f"<DetalleTransferencia(id={self.id}, banco='{self.entidad_bancaria}', "
            f"ref='{self.referencia_pago}', monto={self.monto})>"
        )
