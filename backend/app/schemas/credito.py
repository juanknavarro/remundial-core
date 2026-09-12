import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, List, Optional, Union
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

    if tipo_pago == TipoPago.MENSUAL:
        # Frecuencia mensual: vencimiento programado automáticamente para el último día de cada mes consecutivo
        total_meses = (fecha_inicial.year * 12 + fecha_inicial.month - 1) + cuota_idx
        nuevo_anio = total_meses // 12
        nuevo_mes = (total_meses % 12) + 1
        ultimo_dia = calendar.monthrange(nuevo_anio, nuevo_mes)[1]
        return date(nuevo_anio, nuevo_mes, ultimo_dia)
    elif tipo_pago == TipoPago.QUINCENAL:
        # Frecuencia quincenal (compatibilidad con contratos históricos previos): saltos de 15 días
        return fecha_inicial + timedelta(days=15 * cuota_idx)
    elif tipo_pago == TipoPago.SEMANAL:
        return fecha_inicial + timedelta(days=7 * cuota_idx)
    else:  # DIARIO
        return fecha_inicial + timedelta(days=cuota_idx)


class CuotaCronograma(BaseModel):
    """Representación de cada cuota individual dentro del plan de pagos proyectado."""
    numero: int = Field(..., description="Número ordinal de la cuota (1..N)")
    fecha_vencimiento: date = Field(..., description="Fecha de exigibilidad/vencimiento de la cuota")
    valor_cuota: Decimal = Field(..., description="Monto exigible de cobro para esta cuota (base + arrastre)")
    valor_base: Decimal = Field(default=Decimal("0.00"), description="Valor contractual base de la cuota")
    valor_exigible: Decimal = Field(default=Decimal("0.00"), description="Monto total exigible a cobrar (base + arrastre)")
    valor_pagado: Decimal = Field(default=Decimal("0.00"), description="Monto ya pagado/abonado a esta cuota")
    saldo_cuota: Decimal = Field(default=Decimal("0.00"), description="Saldo insoluto pendiente de pago de esta cuota")
    monto_arrastrado: Decimal = Field(default=Decimal("0.00"), description="Monto no pagado arrastrado desde la cuota previa")
    pagada: bool = Field(default=False, description="Indica si la cuota ya fue pagada completamente")
    es_parcial: bool = Field(default=False, description="Indica si la cuota cuenta con un abono parcial registrado")
    estado: str = Field(default="pendiente", description="Estado operativo: pagada, parcial, vencida, exigible_hoy, futura")


def generar_cronograma_con_arrastre(
    fecha_primera_cuota: date,
    numero_cuotas: int,
    monto_financiado: Decimal,
    saldo_pendiente: Decimal,
    valor_cuota_base: Decimal,
    tipo_pago: TipoPago,
    hoy: Optional[date] = None,
) -> dict:
    """Genera el cronograma de cuotas escalonado aplicando amortización por abonos parciales y arrastre de saldos insolutos."""
    if hoy is None:
        hoy = date.today()

    m_fin = Decimal(monto_financiado or 0)
    s_pen = Decimal(saldo_pendiente or 0)
    val_c = Decimal(valor_cuota_base or 0)
    total_amortizado = max(Decimal("0.00"), m_fin - s_pen)

    cuotas: List[CuotaCronograma] = []
    monto_disponible = total_amortizado
    arrastre_siguiente = Decimal("0.00")
    cuotas_pagadas_count = 0
    proxima_cuota_numero = 1
    encontro_proxima = False

    for i in range(numero_cuotas):
        num_cuota = i + 1
        venc = calcular_fecha_vencimiento(fecha_primera_cuota, i, tipo_pago)

        valor_base = val_c
        monto_arrastrado = arrastre_siguiente
        arrastre_siguiente = Decimal("0.00")  # Aplicado a esta cuota

        # El valor total exigible para este periodo es la cuota base más el saldo insoluto arrastrado
        valor_exigible = valor_base + monto_arrastrado

        if monto_disponible >= valor_exigible:
            # Cubre completamente la cuota y cualquier saldo arrastrado
            valor_pagado = valor_exigible
            monto_disponible -= valor_exigible
            saldo_cuota = Decimal("0.00")
            pagada = True
            es_parcial = False
            st = "pagada"
            cuotas_pagadas_count += 1
        elif monto_disponible > Decimal("0.00"):
            # Abono parcial: cubre parte de la cuota
            valor_pagado = monto_disponible
            saldo_cuota = valor_exigible - monto_disponible
            # La diferencia insoluta se arrastra a la siguiente cuota programada si existe
            if i + 1 < numero_cuotas:
                arrastre_siguiente = saldo_cuota
            monto_disponible = Decimal("0.00")
            pagada = False
            es_parcial = True
            st = "parcial"
            if not encontro_proxima:
                proxima_cuota_numero = num_cuota
                encontro_proxima = True
        else:
            # Sin abonos aplicados a esta cuota
            valor_pagado = Decimal("0.00")
            saldo_cuota = valor_exigible
            pagada = False
            es_parcial = False
            if not encontro_proxima:
                proxima_cuota_numero = num_cuota
                encontro_proxima = True

            if venc < hoy:
                st = "vencida"
            elif venc == hoy:
                st = "exigible_hoy"
            else:
                st = "futura"

        cuotas.append(
            CuotaCronograma(
                numero=num_cuota,
                fecha_vencimiento=venc,
                valor_cuota=valor_exigible,
                valor_base=valor_base,
                valor_exigible=valor_exigible,
                valor_pagado=valor_pagado,
                saldo_cuota=saldo_cuota,
                monto_arrastrado=monto_arrastrado,
                pagada=pagada,
                es_parcial=es_parcial,
                estado=st,
            )
        )

    # Métricas de vencimiento y exigibilidad
    if s_pen <= Decimal("0.00") or cuotas_pagadas_count >= numero_cuotas:
        proximo_vencimiento = None
        cuota_actual_num = numero_cuotas
        esta_vencido = False
        exigible_hoy = False
        dias_mora = 0
    else:
        cuota_actual_num = proxima_cuota_numero
        cuota_act = cuotas[proxima_cuota_numero - 1]
        proximo_vencimiento = cuota_act.fecha_vencimiento
        if proximo_vencimiento < hoy:
            esta_vencido = True
            exigible_hoy = True
            dias_mora = (hoy - proximo_vencimiento).days
        elif proximo_vencimiento == hoy:
            esta_vencido = False
            exigible_hoy = True
            dias_mora = 0
        else:
            esta_vencido = False
            exigible_hoy = False
            dias_mora = 0

    return {
        "cronograma": cuotas,
        "cuotas_pagadas_count": cuotas_pagadas_count,
        "cuota_actual_numero": cuota_actual_num,
        "fecha_proximo_vencimiento": proximo_vencimiento,
        "esta_vencido": esta_vencido,
        "exigible_hoy": exigible_hoy,
        "dias_mora": dias_mora,
    }


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
    tipo_pago: TipoPago = Field(
        default=TipoPago.MENSUAL,
        description="Modalidad de pago (unificada exclusivamente a mensual con vencimiento a fin de mes)",
    )
    cuota_inicial: Decimal = Field(
        default=Decimal("0.00"),
        ge=0,
        description="Valor pagado de contado al momento de la venta",
    )
    monto_financiado: Decimal = Field(..., ge=0, description="Valor neto a financiar en cuotas (0 para venta de contado)")
    numero_cuotas: int = Field(..., gt=0, description="Cantidad total de cuotas pactadas")
    valor_cuota: Decimal = Field(..., ge=0, description="Valor de cada cuota individual (0 para venta de contado)")
    fecha_primera_cuota: Optional[date] = Field(
        None, description="Fecha de exigibilidad de la primera cuota (se autocalcula a fin del mes siguiente si no se envía)"
    )
    fecha_desembolso: Optional[date] = Field(
        None, description="Fecha de desembolso de la operación para cálculo de cuotas"
    )
    fecha_compra: Optional[date] = Field(
        None, description="Fecha de compra (alias de fecha_desembolso)"
    )
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
    firma_titular: Optional[str] = Field(
        None,
        description="Firma digital del cliente titular en formato Base64 PNG capturada en pantalla",
    )
    firma_vendedor: Optional[str] = Field(
        None,
        description="Firma digital del vendedor responsable en formato Base64 PNG capturada en pantalla",
    )
    firma_codeudor: Optional[str] = Field(
        None,
        description="Firma digital opcional del codeudor solidario en formato Base64 PNG",
    )

    @model_validator(mode="before")
    @classmethod
    def autocalcular_vencimiento_primera_cuota(cls, data: Any) -> Any:
        """Garantiza la unificación a modalidad mensual y autocalcula la primera cuota para el último día del mes siguiente a la compra."""
        if isinstance(data, dict):
            # Unificar estrictamente a modalidad mensual para toda nueva originación
            data["tipo_pago"] = TipoPago.MENSUAL.value

            # Normalizar fecha_primera_cuota si no vino explícita
            if not data.get("fecha_primera_cuota"):
                raw_base = data.get("fecha_desembolso") or data.get("fecha_compra")
                if raw_base:
                    if isinstance(raw_base, str):
                        try:
                            f_base = date.fromisoformat(raw_base.split("T")[0])
                        except Exception:
                            f_base = date.today()
                    elif isinstance(raw_base, (date, datetime)):
                        f_base = raw_base.date() if isinstance(raw_base, datetime) else raw_base
                    else:
                        f_base = date.today()
                else:
                    f_base = date.today()

                # Vencimiento fijado para el último día del mes siguiente a la fecha de compra/desembolso
                total_meses = (f_base.year * 12 + f_base.month - 1) + 1
                nuevo_anio = total_meses // 12
                nuevo_mes = (total_meses % 12) + 1
                ultimo_dia = calendar.monthrange(nuevo_anio, nuevo_mes)[1]
                data["fecha_primera_cuota"] = date(nuevo_anio, nuevo_mes, ultimo_dia)
            elif isinstance(data.get("fecha_primera_cuota"), str):
                try:
                    data["fecha_primera_cuota"] = date.fromisoformat(data["fecha_primera_cuota"].split("T")[0])
                except Exception:
                    pass
        return data


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

    # Métricas y campos dinámicos de exigibilidad por vencimiento
    fecha_proximo_vencimiento: Optional[date] = None
    cuota_actual_numero: int = 1
    cuotas_pagadas_count: int = 0
    esta_vencido: bool = False
    exigible_hoy: bool = False
    dias_mora: int = 0

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def autogenerar_cronograma(self) -> "CreditoResponse":
        if self.numero_cuotas > 0 and self.fecha_primera_cuota:
            res = generar_cronograma_con_arrastre(
                fecha_primera_cuota=self.fecha_primera_cuota,
                numero_cuotas=self.numero_cuotas,
                monto_financiado=self.monto_financiado,
                saldo_pendiente=self.saldo_pendiente,
                valor_cuota_base=self.valor_cuota,
                tipo_pago=self.tipo_pago,
            )
            self.cronograma_cuotas = res["cronograma"]
            self.cuotas_pagadas_count = res["cuotas_pagadas_count"]
            self.cuota_actual_numero = res["cuota_actual_numero"]
            self.fecha_proximo_vencimiento = res["fecha_proximo_vencimiento"]
            self.esta_vencido = res["esta_vencido"]
            self.exigible_hoy = res["exigible_hoy"]
            self.dias_mora = res["dias_mora"]
        return self

