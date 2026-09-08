import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.credito import EstadoCredito, TipoPago
from app.schemas.cliente import ClienteResponse
from app.schemas.producto import ProductoResponse
from app.schemas.usuario import UsuarioResponse


def calcular_fecha_vencimiento(fecha_inicial: date, cuota_idx: int, tipo_pago: TipoPago) -> date:
    """Calcula la fecha exacta de vencimiento para la cuota i (0-indexada) según su frecuencia."""
    if cuota_idx == 0:
        return fecha_inicial

    if tipo_pago == TipoPago.QUINCENAL:
        # Frecuencia quincenal: saltos de 15 días continuos por periodo
        return fecha_inicial + timedelta(days=15 * cuota_idx)
    elif tipo_pago == TipoPago.MENSUAL:
        # Frecuencia mensual: conservación del día del mes ajustado a fin de mes si aplica
        total_meses = fecha_inicial.month - 1 + cuota_idx
        nuevo_anio = fecha_inicial.year + (total_meses // 12)
        nuevo_mes = (total_meses % 12) + 1
        max_dias = calendar.monthrange(nuevo_anio, nuevo_mes)[1]
        nuevo_dia = min(fecha_inicial.day, max_dias)
        return date(nuevo_anio, nuevo_mes, nuevo_dia)
    elif tipo_pago == TipoPago.SEMANAL:
        return fecha_inicial + timedelta(days=7 * cuota_idx)
    else:  # DIARIO
        return fecha_inicial + timedelta(days=cuota_idx)


class CuotaCronograma(BaseModel):
    """Representación de cada cuota individual dentro del plan de pagos proyectado."""
    numero: int = Field(..., description="Número ordinal de la cuota (1..N)")
    fecha_vencimiento: date = Field(..., description="Fecha de exigibilidad/vencimiento de la cuota")
    valor_cuota: Decimal = Field(..., description="Valor monetario a pagar en esta cuota")


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
    vendedor_id: Optional[UUID] = Field(None, description="UUID del asesor comercial que originó la venta")
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


class CodeudorCreate(BaseModel):
    """Datos del codeudor solidario de respaldo."""
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre completo del codeudor")
    cedula: Optional[str] = Field(None, max_length=30, description="Cédula de ciudadanía")
    telefono: Optional[str] = Field(None, max_length=25, description="Teléfono de contacto")
    direccion: Optional[str] = Field(None, description="Dirección domiciliaria")

    model_config = ConfigDict(from_attributes=True)


class ReferenciaFamiliarCreate(BaseModel):
    """Datos de la referencia familiar o personal de respaldo."""
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre completo de la referencia")
    telefono: Optional[str] = Field(None, max_length=25, description="Teléfono de contacto")
    parentesco: Optional[str] = Field(None, max_length=50, description="Parentesco o vínculo con el titular")
    direccion: Optional[str] = Field(None, description="Dirección domiciliaria")

    model_config = ConfigDict(from_attributes=True)


class CreditoCreate(CreditoBase):
    """Esquema de entrada para originar un crédito con sus detalles anidados en un solo JSON."""
    detalles: List[CreditoDetalleCreate] = Field(
        ...,
        min_length=1,
        description="Lista de artículos vendidos en esta operación",
    )
    codeudor: Optional[CodeudorCreate] = Field(
        None,
        description="Datos del codeudor solidario (requerido para ventas a crédito)",
    )
    referencia: Optional[ReferenciaFamiliarCreate] = Field(
        None,
        description="Datos de la referencia familiar o personal de respaldo",
    )


class CreditoUpdate(BaseModel):
    """Esquema para actualizaciones administrativas de un crédito."""
    estado: Optional[Union[EstadoCredito, str]] = None
    supervisor_id: Optional[UUID] = None
    cobrador_id: Optional[UUID] = None
    saldo_pendiente: Optional[Decimal] = Field(None, ge=0)
    codeudor: Optional[CodeudorCreate] = None
    referencia: Optional[ReferenciaFamiliarCreate] = None

    @field_validator("estado", mode="before")
    @classmethod
    def normalizar_estado(cls, v):
        if v is None:
            return v
        v_str = str(v).lower().strip()
        if v_str in ("aprobado", "activo", "aprobada", "activa"):
            return EstadoCredito.ACTIVO
        if v_str in ("rechazado", "rechazada", "anulado", "anulada", "terminado"):
            return EstadoCredito.TERMINADO
        if v_str in ("mora", "en mora"):
            return EstadoCredito.MORA
        if v_str in ("pendiente", "por revisar"):
            return EstadoCredito.PENDIENTE
        return v


class CreditoResponse(CreditoBase):
    """Esquema de salida completo para un crédito originado."""
    id_contrato: UUID
    saldo_pendiente: Decimal
    creado_en: datetime
    actualizado_en: datetime
    detalles: List[CreditoDetalleResponse] = []
    cliente: Optional[ClienteResponse] = None
    vendedor: Optional[UsuarioResponse] = None
    supervisor: Optional[UsuarioResponse] = None
    cobrador: Optional[UsuarioResponse] = None
    cronograma_cuotas: List[CuotaCronograma] = []
    codeudor: Optional[CodeudorCreate] = None
    referencia: Optional[ReferenciaFamiliarCreate] = None


    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def autogenerar_cronograma(self) -> "CreditoResponse":
        if not self.cronograma_cuotas and self.numero_cuotas > 0 and self.fecha_primera_cuota:
            cuotas: List[CuotaCronograma] = []
            for i in range(self.numero_cuotas):
                venc = calcular_fecha_vencimiento(self.fecha_primera_cuota, i, self.tipo_pago)
                cuotas.append(
                    CuotaCronograma(
                        numero=i + 1,
                        fecha_vencimiento=venc,
                        valor_cuota=self.valor_cuota,
                    )
                )
            self.cronograma_cuotas = cuotas
        return self

