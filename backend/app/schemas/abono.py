from datetime import datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.abono import EstadoAbono
from app.schemas.cliente import CoordenadasGPS
from app.schemas.usuario import UsuarioResponse


class AbonoBase(BaseModel):
    """Esquema base para recaudos/abonos."""
    credito_id: UUID = Field(..., description="UUID del crédito al que se aplica el pago")
    cobrador_id: UUID = Field(..., description="UUID del cobrador que realiza el recaudo")
    valor_abonado: Decimal = Field(
        ...,
        gt=0,
        description="Monto recaudado en efectivo o transferencia (debe ser mayor a cero)",
    )
    coordenadas_gps_cobro: CoordenadasGPS = Field(
        ...,
        description="Ubicación geográfica obligatoria capturada en terreno al momento del cobro",
    )
    metodo_pago: Optional[str] = Field(
        default="efectivo",
        description="Método de pago utilizado (efectivo, transferencia, etc.)",
    )
    notas: Optional[str] = Field(
        default=None,
        description="Notas u observaciones del recaudo",
    )
    numero_cuota: Optional[int] = Field(
        default=None,
        description="Número de cuota opcional asociado al recaudo",
    )


class AbonoCreate(AbonoBase):
    """Esquema para recepción de abono desde la aplicación móvil o panel web."""

    @model_validator(mode="before")
    @classmethod
    def normalize_input(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Normalizar valor_abono, monto o valor si se envía con esa clave
            if "valor_abonado" not in data or data.get("valor_abonado") is None:
                for k in ("valor_abono", "monto", "valor", "monto_abono"):
                    if k in data and data[k] is not None:
                        data["valor_abonado"] = data[k]
                        break

            # Normalizar coordenadas_gps_cobro si vienen latitud y longitud planas
            if "coordenadas_gps_cobro" not in data or not data.get("coordenadas_gps_cobro"):
                lat = data.get("latitud") if data.get("latitud") is not None else data.get("lat")
                lon = (
                    data.get("longitud")
                    if data.get("longitud") is not None
                    else (data.get("lng") if data.get("lng") is not None else data.get("lon"))
                )
                if lat is not None and lon is not None:
                    try:
                        data["coordenadas_gps_cobro"] = {
                            "latitud": float(lat),
                            "longitud": float(lon),
                        }
                    except (ValueError, TypeError):
                        pass
        return data


class AbonoResponse(BaseModel):
    """Esquema de salida para comprobante de recaudo."""
    id_recibo: UUID
    credito_id: UUID
    cobrador_id: UUID
    fecha: datetime
    valor_abonado: Decimal
    coordenadas_gps_cobro: Optional[CoordenadasGPS] = None
    estado: EstadoAbono
    cierre_caja_id: Optional[UUID] = None
    creado_en: datetime
    saldo_restante_credito: Optional[Decimal] = Field(
        None,
        description="Saldo actualizado del crédito tras registrar este abono",
    )
    cobrador: Optional[UsuarioResponse] = None
    cliente_nombre: Optional[str] = None
    cliente_cedula: Optional[str] = None
    numero_contrato: Optional[str] = None
    metodo_pago: Optional[str] = "efectivo"

    model_config = ConfigDict(from_attributes=True)


class ConciliacionRutaRequest(BaseModel):
    """Esquema para la conciliación y cierre de caja de una ruta de cobro."""
    cobrador_id: UUID
    efectivo_entregado: Decimal = Field(..., ge=0, description="Monto en efectivo recibido físicamente en caja")
    notas: Optional[str] = Field(None, description="Observaciones o notas de auditoría sobre el cuadre")


class ConciliacionRutaResponse(BaseModel):
    """Resultado del cuadre y cierre contable de la ruta."""
    id: Optional[UUID] = None
    cobrador_id: UUID
    cobrador_nombre: str
    responsable_id: Optional[UUID] = None
    responsable_nombre: Optional[str] = None
    total_esperado: Decimal
    efectivo_entregado: Decimal
    diferencia: Decimal
    cuadre_estado: str
    abonos_conciliados_count: int
    fecha_conciliacion: datetime
    mensaje: str
    notas: Optional[str] = None


class CierreCajaResponse(BaseModel):
    """Esquema de salida para actas históricas de cierre de caja."""
    id: UUID
    cobrador_id: UUID
    cobrador_nombre: str
    responsable_id: UUID
    responsable_nombre: str
    fecha_cierre: datetime
    total_esperado: Decimal
    efectivo_entregado: Decimal
    diferencia: Decimal
    cuadre_estado: str
    abonos_conciliados_count: int
    notas: Optional[str] = None
    creado_en: datetime

    model_config = ConfigDict(from_attributes=True)
