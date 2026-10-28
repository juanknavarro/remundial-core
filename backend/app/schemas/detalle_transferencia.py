from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DetalleTransferenciaBase(BaseModel):
    """Esquema base para un comprobante o desglose de transferencia bancaria."""
    entidad_bancaria: str = Field(
        ...,
        min_length=2,
        max_length=100,
        description="Entidad bancaria o pasarela (ej. Bancolombia, Nequi, Daviplata)",
    )
    referencia_pago: str = Field(
        ...,
        min_length=3,
        max_length=100,
        description="Número de referencia o comprobante de la transferencia",
    )
    monto: Decimal = Field(
        ...,
        gt=0,
        description="Monto transferido en COP (debe ser mayor a cero)",
    )

    @field_validator("entidad_bancaria")
    @classmethod
    def clean_entidad(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("La entidad bancaria no puede estar vacía.")
        return s

    @field_validator("referencia_pago")
    @classmethod
    def clean_referencia(cls, v: str) -> str:
        s = v.strip()
        if len(s) < 3:
            raise ValueError("La referencia de pago debe contener al menos 3 caracteres alfanuméricos.")
        return s


class DetalleTransferenciaCreate(DetalleTransferenciaBase):
    """Esquema de entrada para registrar un comprobante de transferencia."""
    pass


class DetalleTransferenciaResponse(DetalleTransferenciaBase):
    """Esquema de salida para un comprobante de transferencia."""
    id: UUID
    venta_id: Optional[UUID] = None
    abono_id: Optional[UUID] = None
    creado_en: datetime

    model_config = ConfigDict(from_attributes=True)
