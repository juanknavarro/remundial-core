import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EstadoCredito(str, enum.Enum):
    """Ciclo de vida del crédito."""
    PENDIENTE = "pendiente"
    ACTIVO = "activo"
    TERMINADO = "terminado"
    MORA = "mora"


class TipoPago(str, enum.Enum):
    """Frecuencia de amortización."""
    DIARIO = "diario"
    SEMANAL = "semanal"
    QUINCENAL = "quincenal"
    MENSUAL = "mensual"


class Credito(Base):
    """Modelo ORM para contratos de crédito según init.sql."""

    __tablename__ = "creditos"

    id_contrato: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    cliente_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clientes.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    vendedor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    supervisor_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    cobrador_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    estado: Mapped[EstadoCredito] = mapped_column(
        PG_ENUM(
            EstadoCredito,
            name="estado_credito_enum",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=EstadoCredito.PENDIENTE,
        server_default="pendiente",
        nullable=False,
        index=True,
    )
    tipo_pago: Mapped[TipoPago] = mapped_column(
        PG_ENUM(
            TipoPago,
            name="tipo_pago_enum",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    cuota_inicial: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        default=Decimal("0.00"),
        server_default="0.00",
        nullable=False,
    )
    monto_financiado: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    numero_cuotas: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    valor_cuota: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    fecha_primera_cuota: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        index=True,
    )
    saldo_pendiente: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    numero_contrato: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        index=True,
    )
    ciudad_venta: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )
    departamento_venta: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )
    metodo_pago_inicial: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    referencia_pago_inicial: Mapped[Optional[str]] = mapped_column(
        String(100),
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

    # Restricciones
    __table_args__ = (
        CheckConstraint("cuota_inicial >= 0", name="chk_cuota_inicial_non_neg"),
        CheckConstraint("monto_financiado >= 0", name="chk_monto_financiado_pos"),
        CheckConstraint("numero_cuotas > 0", name="chk_numero_cuotas_pos"),
        CheckConstraint("valor_cuota >= 0", name="chk_valor_cuota_pos"),
        CheckConstraint("saldo_pendiente >= 0", name="chk_saldo_pendiente_non_neg"),
    )

    # Relaciones ORM (Eager loading asíncrono con selectin)
    cliente = relationship("Cliente", foreign_keys=[cliente_id], lazy="selectin")
    vendedor = relationship("Usuario", foreign_keys=[vendedor_id], lazy="selectin")
    supervisor = relationship("Usuario", foreign_keys=[supervisor_id], lazy="selectin")
    cobrador = relationship("Usuario", foreign_keys=[cobrador_id], lazy="selectin")
    detalles: Mapped[List["CreditoDetalle"]] = relationship(
        "CreditoDetalle",
        back_populates="credito",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    abonos = relationship(
        "Abono",
        back_populates="credito",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return (
            f"<Credito(id_contrato={self.id_contrato}, numero_contrato={self.numero_contrato}, "
            f"cliente_id={self.cliente_id}, monto={self.monto_financiado}, estado='{self.estado}')>"
        )


class CreditoDetalle(Base):
    """Modelo ORM para las líneas de artículos asociados a un crédito."""

    __tablename__ = "credito_detalle"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    credito_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("creditos.id_contrato", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    producto_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("productos.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    cantidad: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    valor_unitario_acordado: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    # Columna calculada por PostgreSQL: GENERATED ALWAYS AS (cantidad * valor_unitario_acordado) STORED
    subtotal: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        server_default=FetchedValue(),
    )

    __table_args__ = (
        UniqueConstraint("credito_id", "producto_id", name="uq_credito_producto"),
        CheckConstraint("cantidad > 0", name="chk_detalle_cantidad_pos"),
        CheckConstraint("valor_unitario_acordado >= 0", name="chk_detalle_valor_non_neg"),
    )

    # Relaciones ORM
    credito: Mapped["Credito"] = relationship("Credito", back_populates="detalles")
    producto = relationship("Producto", foreign_keys=[producto_id], lazy="selectin")

    def __repr__(self) -> str:
        return (
            f"<CreditoDetalle(id={self.id}, credito_id={self.credito_id}, "
            f"producto_id={self.producto_id}, cantidad={self.cantidad})>"
        )
