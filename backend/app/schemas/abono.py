from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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


class AbonoCreate(AbonoBase):
    """Esquema para recepción de abono desde la aplicación móvil."""
    pass


class AbonoResponse(BaseModel):
    """Esquema de salida para comprobante de recaudo."""
    id_recibo: UUID
    credito_id: UUID
    cobrador_id: UUID
    fecha: datetime
    valor_abonado: Decimal
    coordenadas_gps_cobro: Optional[CoordenadasGPS] = None
    estado: EstadoAbono
    creado_en: datetime
    saldo_restante_credito: Optional[Decimal] = Field(
        None,
        description="Saldo actualizado del crédito tras registrar este abono",
    )
    cobrador: Optional[UsuarioResponse] = None
    cliente_nombre: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ConciliacionRutaRequest(BaseModel):
    """Esquema para la conciliación y cierre de caja de una ruta de cobro."""
    cobrador_id: UUID
    efectivo_entregado: Decimal = Field(..., ge=0, description="Monto en efectivo recibido físicamente en caja")
    notas: Optional[str] = Field(None, description="Observaciones o notas de auditoría sobre el cuadre")


class ConciliacionRutaResponse(BaseModel):
    """Resultado del cuadre y cierre contable de la ruta."""
    cobrador_id: UUID
    cobrador_nombre: str
    total_esperado: Decimal
    efectivo_entregado: Decimal
    diferencia: Decimal
    cuadre_estado: str
    abonos_conciliados_count: int
    fecha_conciliacion: datetime
    mensaje: str
