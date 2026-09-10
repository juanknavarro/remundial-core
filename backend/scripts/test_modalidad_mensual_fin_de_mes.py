"""
Prueba unitaria de la lógica de originación exclusiva mensual con fin de mes.
Verifica:
1. Cálculo automático de fecha de primera cuota al fin del mes siguiente a la compra.
2. Cronograma de cuotas sucesivas fijadas al fin de cada mes consecutivo (incluyendo febrero y meses de 30/31 días).
3. Forzado de tipo_pago a TipoPago.MENSUAL en CreditoCreate.
"""
import calendar
from datetime import date
from decimal import Decimal
from uuid import uuid4

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.credito import TipoPago
from app.schemas.credito import CreditoCreate, CreditoDetalleCreate, CreditoResponse, calcular_fecha_vencimiento


def test_calcular_fecha_vencimiento():
    # Caso 1: Compra el 10 de septiembre de 2026 -> Primera cuota el 31 de octubre de 2026
    fecha_primera = date(2026, 10, 31)
    
    # Cuota 1 (idx=0): 31 de octubre
    venc_0 = calcular_fecha_vencimiento(fecha_primera, 0, TipoPago.MENSUAL)
    assert venc_0 == date(2026, 10, 31), f"Esperado 2026-10-31, obtenido {venc_0}"

    # Cuota 2 (idx=1): 30 de noviembre
    venc_1 = calcular_fecha_vencimiento(fecha_primera, 1, TipoPago.MENSUAL)
    assert venc_1 == date(2026, 11, 30), f"Esperado 2026-11-30, obtenido {venc_1}"

    # Cuota 3 (idx=2): 31 de diciembre
    venc_2 = calcular_fecha_vencimiento(fecha_primera, 2, TipoPago.MENSUAL)
    assert venc_2 == date(2026, 12, 31), f"Esperado 2026-12-31, obtenido {venc_2}"

    # Cuota 4 (idx=3): 31 de enero de 2027
    venc_3 = calcular_fecha_vencimiento(fecha_primera, 3, TipoPago.MENSUAL)
    assert venc_3 == date(2027, 1, 31), f"Esperado 2027-01-31, obtenido {venc_3}"

    # Cuota 5 (idx=4): 28 de febrero de 2027 (no bisiesto)
    venc_4 = calcular_fecha_vencimiento(fecha_primera, 4, TipoPago.MENSUAL)
    assert venc_4 == date(2027, 2, 28), f"Esperado 2027-02-28, obtenido {venc_4}"

    # Cuota 6 (idx=5): 31 de marzo de 2027
    venc_5 = calcular_fecha_vencimiento(fecha_primera, 5, TipoPago.MENSUAL)
    assert venc_5 == date(2027, 3, 31), f"Esperado 2027-03-31, obtenido {venc_5}"

    print("[OK] [TEST 1] calcular_fecha_vencimiento calcula exactamente el último día de cada mes consecutivo.")


def test_autocalculo_primera_cuota():
    # Compra el 10 de septiembre de 2026
    c_in = CreditoCreate(
        cliente_id=uuid4(),
        fecha_compra=date(2026, 9, 10),
        monto_financiado=Decimal("400000.00"),
        numero_cuotas=4,
        valor_cuota=Decimal("100000.00"),
        detalles=[
            CreditoDetalleCreate(
                producto_id=uuid4(),
                cantidad=1,
                valor_unitario_acordado=Decimal("400000.00"),
            )
        ]
    )

    assert c_in.tipo_pago == TipoPago.MENSUAL, f"Esperado MENSUAL, obtenido {c_in.tipo_pago}"
    assert c_in.fecha_primera_cuota == date(2026, 10, 31), f"Esperado 2026-10-31, obtenido {c_in.fecha_primera_cuota}"
    print(f"[OK] [TEST 2] CreditoCreate autocalcula fecha_primera_cuota={c_in.fecha_primera_cuota} (fin del mes siguiente).")

    # Compra el 15 de diciembre de 2026 -> fin de enero 2027
    c_in_dic = CreditoCreate(
        cliente_id=uuid4(),
        fecha_compra=date(2026, 12, 15),
        monto_financiado=Decimal("300000.00"),
        numero_cuotas=3,
        valor_cuota=Decimal("100000.00"),
        detalles=[
            CreditoDetalleCreate(
                producto_id=uuid4(),
                cantidad=1,
                valor_unitario_acordado=Decimal("300000.00"),
            )
        ]
    )
    assert c_in_dic.fecha_primera_cuota == date(2027, 1, 31), f"Esperado 2027-01-31, obtenido {c_in_dic.fecha_primera_cuota}"
    print(f"[OK] [TEST 3] Cambio de año: Compra dic-2026 -> fecha_primera_cuota={c_in_dic.fecha_primera_cuota}.")


def test_cronograma_en_credito_response():
    resp = CreditoResponse(
        id_contrato=uuid4(),
        cliente_id=uuid4(),
        saldo_pendiente=Decimal("400000.00"),
        monto_financiado=Decimal("400000.00"),
        numero_cuotas=4,
        valor_cuota=Decimal("100000.00"),
        fecha_primera_cuota=date(2026, 10, 31),
        tipo_pago=TipoPago.MENSUAL,
        creado_en=date(2026, 9, 10),
        actualizado_en=date(2026, 9, 10),
        detalles=[]
    )

    fechas = [c.fecha_vencimiento for c in resp.cronograma_cuotas]
    esperadas = [
        date(2026, 10, 31),
        date(2026, 11, 30),
        date(2026, 12, 31),
        date(2027, 1, 31),
    ]
    assert fechas == esperadas, f"Esperadas {esperadas}, obtenidas {fechas}"
    print("[OK] [TEST 4] Cronograma de cuotas en CreditoResponse generado exitosamente:")
    for c in resp.cronograma_cuotas:
        print(f"   Cuota #{c.numero}: {c.fecha_vencimiento} - ${c.valor_cuota}")


if __name__ == "__main__":
    test_calcular_fecha_vencimiento()
    test_autocalculo_primera_cuota()
    test_cronograma_en_credito_response()
    print("\nTODAS LAS PRUEBAS DE MODALIDAD MENSUAL CON FIN DE MES PASARON EXITOSAMENTE.")
