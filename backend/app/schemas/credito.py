from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.credito import EstadoCredito, TipoPago
from app.schemas.cliente import ClienteResponse
from app.schemas.producto import ProductoResponse
from app.schemas.usuario import UsuarioResponse


class CreditoDetalleBase(BaseModel):
    """Esquema base para cada línea de detalle de crédito."""
    producto_id: UUID = Field(..., description="ID del producto adquirido")
    cantidad: int = Field(..., gt=0, description="Cantidad de unidades vendidas")
    valor_unitario_acordado: Decimal = Field(
        ..., ge=0, description="Precio unitario pactado al originar el crédito"
    )


class CreditoDetalleCreate(CreditoDetalleBase):
    """Esquema para crear un detalle dentro del payload de crédito."""
    pass


class CreditoDetalleResponse(CreditoDetalleBase):
    """Esquema de salida para el detalle de un crédito."""
    id: UUID
    credito_id: UUID
    subtotal: Decimal
    producto: Optional[ProductoResponse] = None

    model_config = ConfigDict(from_attributes=True)


class CreditoBase(BaseModel):
    """Esquema base con los datos contractuales y financieros del crédito."""
    cliente_id: UUID = Field(..., description="UUID del cliente titular del crédito")
    vendedor_id: UUID = Field(..., description="UUID del asesor comercial que originó la venta")
    supervisor_id: Optional[UUID] = Field(None, description="UUID del supervisor a cargo")
    cobrador_id: Optional[UUID] = Field(None, description="UUID del cobrador asignado a la ruta")
    estado: EstadoCredito = Field(
        default=EstadoCredito.PENDIENTE,
        description="Estado inicial del crédito (pendiente, activo, etc.)",
    )
    tipo_pago: TipoPago = Field(..., description="Modalidad de pago (diario, semanal, quincenal, mensual)")
    cuota_inicial: Decimal = Field(
        default=Decimal("0.00"),
        ge=0,
        description="Valor pagado de contado al momento de la venta",
    )
    monto_financiado: Decimal = Field(..., ge=0, description="Valor neto a financiar en cuotas (0 para venta de contado)")
    numero_cuotas: int = Field(..., gt=0, description="Cantidad total de cuotas pactadas")
    valor_cuota: Decimal = Field(..., ge=0, description="Valor de cada cuota individual (0 para venta de contado)")
    fecha_primera_cuota: date = Field(..., description="Fecha de exigibilidad de la primera cuota")
    saldo_pendiente: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Saldo pendiente inicial (si no se envía, toma el monto financiado)",
    )


class CreditoCreate(CreditoBase):
    """Esquema de entrada para originar un crédito con sus detalles anidados en un solo JSON."""
    detalles: List[CreditoDetalleCreate] = Field(
        ...,
        min_length=1,
        description="Lista de artículos vendidos en esta operación",
    )


class CreditoUpdate(BaseModel):
    """Esquema para actualizaciones administrativas de un crédito."""
    estado: Optional[EstadoCredito] = None
    supervisor_id: Optional[UUID] = None
    cobrador_id: Optional[UUID] = None
    saldo_pendiente: Optional[Decimal] = Field(None, ge=0)


class CreditoResponse(CreditoBase):
    """Esquema de salida completo para un crédito originado."""
    id_contrato: UUID
    saldo_pendiente: Decimal
    creado_en: datetime
    actualizado_en: datetime
    detalles: List[CreditoDetalleResponse] = []
    cliente: Optional[ClienteResponse] = None
    vendedor: Optional[UsuarioResponse] = None

    model_config = ConfigDict(from_attributes=True)
