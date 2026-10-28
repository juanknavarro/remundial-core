from datetime import datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class VentaAnuladaBase(BaseModel):
    monto_total: Decimal = Field(..., ge=0, description="Monto total cobrado o pactado de la venta")
    metodo_pago_original: str = Field(..., description="Efectivo, Transferencia o Mixto")
    referencia_original: Optional[str] = Field(None, description="Referencia bancaria inicial si aplica")
    articulos_json: Any = Field(default_factory=list, description="Lista o desglose de artículos que componían la venta")
    estado_devolucion: str = Field(
        ...,
        description="EFECTIVO_DEVUELTO_EN_RUTA o PENDIENTE_REEMBOLSO_TRANSFERENCIA"
    )
    banco_destino_cliente: Optional[str] = Field(None, description="Banco del cliente para realizar el reintegro")
    cuenta_destino_cliente: Optional[str] = Field(None, description="Número de cuenta o billetera del cliente")
    notas_vendedor: Optional[str] = Field(None, description="Motivo, justificación o notas del vendedor en terreno")
    firma_vendedor: Optional[str] = Field(None, description="Firma digital base64 del asesor comercial")
    firma_cliente: Optional[str] = Field(None, description="Firma digital base64 del cliente que recibe o solicita devolución")


class VentaAnuladaCreate(VentaAnuladaBase):
    vendedor_id: Optional[UUID] = Field(None, description="ID del vendedor (si no se envía se infiere del token)")
    fecha: Optional[datetime] = Field(None, description="Fecha de la venta original/anulación")


class VentaAnuladaReembolsoUpdate(BaseModel):
    referencia_reembolso_oficina: str = Field(..., min_length=2, max_length=100, description="Referencia del giro/transferencia de reembolso de oficina")
    banco_origen_reembolso: Optional[str] = Field(None, max_length=100, description="Banco desde el cual la oficina emitió el reembolso")
    fecha_reembolso: Optional[datetime] = Field(None, description="Fecha efectiva de liquidación del reembolso")
    notas_oficina: Optional[str] = Field(None, description="Observaciones o notas adicionales de oficina")


class VentaAnuladaResponse(VentaAnuladaBase):
    id: UUID
    fecha: datetime
    vendedor_id: UUID
    vendedor_nombre: Optional[str] = None
    referencia_reembolso_oficina: Optional[str] = None
    banco_origen_reembolso: Optional[str] = None
    fecha_reembolso: Optional[datetime] = None
    creado_en: datetime

    model_config = ConfigDict(from_attributes=True)
