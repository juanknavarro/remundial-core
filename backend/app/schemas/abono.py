from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.abono import EstadoAbono
from app.schemas.cliente import CoordenadasGPS
from app.schemas.detalle_transferencia import (
    DetalleTransferenciaCreate,
    DetalleTransferenciaResponse,
)
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
    monto_efectivo: Optional[Decimal] = Field(
        default=Decimal("0.00"),
        description="Monto recaudado en efectivo",
    )
    monto_transferencia: Optional[Decimal] = Field(
        default=Decimal("0.00"),
        description="Monto recaudado por transferencia bancaria",
    )
    referencia_pago: Optional[str] = Field(
        default=None,
        description="Número de referencia o comprobante de la transferencia",
    )
    banco_transferencia: Optional[str] = Field(
        default=None,
        description="Entidad bancaria o pasarela origen de la transferencia (ej. Bancolombia, Nequi)",
    )
    transferencias: Optional[List[DetalleTransferenciaCreate]] = Field(
        default_factory=list,
        description="Lista de transferencias asociadas al recaudo (hasta 3)",
    )
    notas: Optional[str] = Field(
        default=None,
        description="Notas u observaciones del recaudo",
    )
    numero_cuota: Optional[int] = Field(
        default=None,
        description="Número de cuota opcional asociado al recaudo",
    )
    firma_cliente: Optional[str] = Field(
        default=None,
        description="Firma manuscrita digitalizada del cliente titular en formato Base64 PNG",
    )
    firma_cobrador: Optional[str] = Field(
        default=None,
        description="Firma manuscrita digitalizada del cobrador autorizado en formato Base64 PNG",
    )
    cobrador_nombre: Optional[str] = Field(
        default=None,
        description="Nombre real del cobrador en ruta que registra el recaudo",
    )
    fecha_siguiente_visita: Optional[date] = Field(
        default=None,
        description="Fecha agendada para la siguiente visita en modalidad dinámica",
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

            # Limpiar montos numéricos de texto vacío
            for mk in ("monto_efectivo", "monto_transferencia"):
                if mk in data:
                    if data[mk] == "" or data[mk] is None:
                        data[mk] = 0

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

    @model_validator(mode="after")
    def validate_metodos_pago(self) -> "AbonoCreate":
        metodo = (self.metodo_pago or "efectivo").strip().lower()
        v_abonado = Decimal(str(self.valor_abonado or 0))

        if self.transferencias and len(self.transferencias) > 3:
            raise ValueError("Descuadre matemático de caja: Se permite un máximo de 3 comprobantes de transferencia.")

        if metodo == "efectivo":
            if not self.monto_efectivo or self.monto_efectivo == Decimal("0.00"):
                self.monto_efectivo = v_abonado
            self.monto_transferencia = Decimal("0.00")
            self.transferencias = []
            self.banco_transferencia = None
            self.referencia_pago = None
        elif metodo == "transferencia":
            if self.transferencias and len(self.transferencias) > 0:
                total_trans = sum((Decimal(str(t.monto)) for t in self.transferencias), Decimal("0.00"))
                if total_trans != v_abonado:
                    raise ValueError(
                        f"Descuadre matemático de caja: El total de las transferencias (${total_trans:.2f}) "
                        f"no coincide exactamente con el valor del abono (${v_abonado:.2f})."
                    )
                self.monto_transferencia = total_trans
                self.monto_efectivo = Decimal("0.00")
                self.banco_transferencia = self.transferencias[0].entidad_bancaria
                self.referencia_pago = self.transferencias[0].referencia_pago
            else:
                if not self.monto_transferencia or self.monto_transferencia == Decimal("0.00"):
                    self.monto_transferencia = v_abonado
                self.monto_efectivo = Decimal("0.00")
                if self.monto_transferencia <= Decimal("0.00"):
                    raise ValueError("El monto transferido debe ser mayor a $0 COP.")
                banco = (self.banco_transferencia or "").strip()
                if not banco:
                    raise ValueError("Debe seleccionar la entidad bancaria origen de la transferencia.")
                ref = (self.referencia_pago or "").strip()
                if not ref:
                    raise ValueError("Debe ingresar el número de comprobante o referencia bancaria para pagos por transferencia.")
                if len(ref) < 3:
                    raise ValueError("La referencia de pago debe contener al menos 3 caracteres alfanuméricos válidos.")
                self.banco_transferencia = banco
                self.referencia_pago = ref
                self.transferencias = [
                    DetalleTransferenciaCreate(
                        entidad_bancaria=banco,
                        referencia_pago=ref,
                        monto=v_abonado,
                    )
                ]
        elif metodo == "mixto":
            m_efectivo = Decimal(str(self.monto_efectivo or 0))
            if self.transferencias and len(self.transferencias) > 0:
                total_trans = sum((Decimal(str(t.monto)) for t in self.transferencias), Decimal("0.00"))
                self.monto_transferencia = total_trans
                self.banco_transferencia = self.transferencias[0].entidad_bancaria
                self.referencia_pago = self.transferencias[0].referencia_pago
            else:
                m_trans = Decimal(str(self.monto_transferencia or 0))
                if m_trans > Decimal("0.00"):
                    banco = (self.banco_transferencia or "").strip()
                    if not banco:
                        raise ValueError("Debe seleccionar la entidad bancaria para la porción transferida en el pago mixto.")
                    ref = (self.referencia_pago or "").strip()
                    if not ref:
                        raise ValueError("Debe ingresar el número de comprobante o referencia de la transferencia en el pago mixto.")
                    if len(ref) < 3:
                        raise ValueError("La referencia de pago debe contener al menos 3 caracteres alfanuméricos válidos.")
                    self.banco_transferencia = banco
                    self.referencia_pago = ref
                    self.transferencias = [
                        DetalleTransferenciaCreate(
                            entidad_bancaria=banco,
                            referencia_pago=ref,
                            monto=m_trans,
                        )
                    ]
                else:
                    self.banco_transferencia = None
                    self.referencia_pago = None
                    self.transferencias = []

            total_pago = m_efectivo + Decimal(str(self.monto_transferencia or 0))
            if total_pago != v_abonado:
                raise ValueError(
                    f"Descuadre matemático de caja: En recaudo mixto, la suma de monto_efectivo (${m_efectivo:.2f}) "
                    f"y transferencias (${self.monto_transferencia:.2f}) debe ser estrictamente igual al "
                    f"valor_abonado (${v_abonado:.2f})."
                )
            self.monto_efectivo = m_efectivo
        return self


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
    monto_efectivo: Optional[Decimal] = Decimal("0.00")
    monto_transferencia: Optional[Decimal] = Decimal("0.00")
    referencia_pago: Optional[str] = None
    banco_transferencia: Optional[str] = None
    transferencias: List[DetalleTransferenciaResponse] = []
    es_abono_parcial: Optional[bool] = Field(
        default=False,
        description="Indica si este recaudo correspondió a un pago parcial de la cuota",
    )
    diferencia_arrastrada: Optional[Decimal] = Field(
        default=Decimal("0.00"),
        description="Monto insoluto no cubierto que se suma a la exigibilidad de la siguiente cuota",
    )
    cuota_afectada_numero: Optional[int] = Field(
        default=None,
        description="Número de la cuota impactada por este abono",
    )
    valor_cuota_siguiente: Optional[Decimal] = Field(
        default=None,
        description="Nuevo monto exigible proyectado para la siguiente cuota programada",
    )
    firma_cliente: Optional[str] = Field(
        default=None,
        description="Firma manuscrita digitalizada del cliente titular en formato Base64 PNG",
    )
    firma_cobrador: Optional[str] = Field(
        default=None,
        description="Firma manuscrita digitalizada del cobrador autorizado en formato Base64 PNG",
    )
    cobrador_nombre: Optional[str] = Field(
        default=None,
        description="Nombre del cobrador en ruta que realizó el recaudo",
    )
    ciudad: Optional[str] = Field(
        default=None,
        description="Ciudad del cliente o donde se celebró la venta para contexto geográfico",
    )
    fecha_siguiente_visita: Optional[date] = Field(
        default=None,
        description="Fecha agendada para la siguiente visita en modalidad dinámica",
    )

    model_config = ConfigDict(from_attributes=True)


class ReciboOfflinePdfRequest(BaseModel):
    """Payload para generar el PDF oficial mediante ReportLab cuando el recibo está en cola local offline."""
    id_recibo: Optional[str] = "ABONO-OFF"
    numero_contrato: Optional[str] = None
    credito_id: Optional[str] = None
    cliente: Optional[str] = None
    cliente_nombre: Optional[str] = None
    cliente_cedula: Optional[str] = None
    cliente_telefono: Optional[str] = None
    cobrador_nombre: Optional[str] = None
    cobrador_telefono: Optional[str] = None
    valor: Optional[Decimal] = None
    valor_abonado: Optional[Decimal] = None
    nuevoSaldo: Optional[Decimal] = None
    saldo_restante_credito: Optional[Decimal] = None
    saldo_pendiente: Optional[Decimal] = None
    es_abono_parcial: Optional[bool] = False
    saldo_insoluto: Optional[Decimal] = Decimal("0.00")
    diferencia_arrastrada: Optional[Decimal] = None
    cuota_numero: Optional[int] = 1
    cuota_afectada_numero: Optional[int] = None
    cuota_siguiente_numero: Optional[int] = None
    valor_cuota_siguiente: Optional[Decimal] = None
    valor_cuota_exigible: Optional[Decimal] = None
    metodo_pago: Optional[str] = "efectivo"
    monto_efectivo: Optional[Decimal] = None
    monto_transferencia: Optional[Decimal] = None
    banco_transferencia: Optional[str] = None
    referencia_pago: Optional[str] = None
    fecha: Optional[str] = None
    fecha_completa: Optional[str] = None
    nombre_archivo_pdf: Optional[str] = None
    firma_cliente: Optional[str] = None
    firma_cobrador: Optional[str] = None
    fecha_siguiente_visita: Optional[date | str] = Field(
        default=None,
        description="Fecha pactada para la próxima visita de cobro en modalidad dinámica",
    )


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
