import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

# Ensure backend root is on PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.pdf_recibo import generar_pdf_recibo_abono, construir_nombre_archivo_pdf

class MockModel:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

def run_test():
    print("=== TESTING GENERATION OF RECIBO DE CAJA (TOTAL VS PARCIAL) ===")
    
    # 1. Pago total de cuota ($120.000)
    abono_total = MockModel(
        id_recibo=uuid4(),
        credito_id=uuid4(),
        cobrador_id=uuid4(),
        fecha_pago=datetime.now(timezone.utc),
        valor_abonado=Decimal("120000.00"),
        estado="registrado",
        es_abono_parcial=False,
        diferencia_arrastrada=Decimal("0.00"),
        cuota_afectada_numero=1,
        valor_cuota_siguiente=Decimal("120000.00"),
        saldo_restante_credito=Decimal("480000.00"),
        cliente_nombre="Carlos Mendoza Perez",
        cliente_cedula="1067891234",
        numero_contrato="CTR-MOCK-001",
        metodo_pago="efectivo",
        notas="Pago completo de cuota 1 de 5",
        credito=MockModel(
            valor_cuota=Decimal("120000.00"),
            monto_financiado=Decimal("600000.00"),
            numero_cuotas=5,
            tipo_pago="quincenal",
            fecha_primera_cuota=datetime.now(timezone.utc),
            saldo_pendiente=Decimal("480000.00"),
            cobrador=MockModel(nombre="Jorge Cobrador Terreno", cedula="98765432"),
            cliente=MockModel(nombres="Carlos", apellidos="Mendoza", cedula="1067891234", telefono="3001234567")
        ),
        cobrador=MockModel(nombre="Jorge Cobrador Terreno", cedula="98765432"),
        coordenadas_gps_cobro={"latitud": 8.7564, "longitud": -75.8841}
    )

    pdf_total_bytes = generar_pdf_recibo_abono(abono_total)
    name_total = construir_nombre_archivo_pdf("Pago_Cuota", abono_total.numero_contrato, abono_total.cliente_nombre, abono_total.fecha_pago)
    print(f"[OK] PDF Pago Total generado: {len(pdf_total_bytes)} bytes - Nombre: {name_total}")
    assert len(pdf_total_bytes) > 2000, "El PDF generado debe tener contenido valido"
    assert name_total.startswith("Pago_Cuota_CTR-MOCK-001_Carlos_Mendoza_Perez"), f"Nombre inesperado: {name_total}"

    # 2. Abono parcial ($50.000 de $120.000 cuota -> $70.000 saldo insoluto)
    abono_parcial = MockModel(
        id_recibo=uuid4(),
        credito_id=uuid4(),
        cobrador_id=uuid4(),
        fecha_pago=datetime.now(timezone.utc),
        valor_abonado=Decimal("50000.00"),
        estado="registrado",
        es_abono_parcial=True,
        diferencia_arrastrada=Decimal("70000.00"),
        cuota_afectada_numero=1,
        valor_cuota_siguiente=Decimal("190000.00"),
        saldo_restante_credito=Decimal("550000.00"),
        cliente_nombre="Maria Fernanda Gomez",
        cliente_cedula="1098765432",
        numero_contrato="CTR-PARC-002",
        metodo_pago="efectivo",
        notas="Abono parcial a cuota 1 de 5",
        credito=MockModel(
            valor_cuota=Decimal("120000.00"),
            monto_financiado=Decimal("600000.00"),
            numero_cuotas=5,
            tipo_pago="quincenal",
            fecha_primera_cuota=datetime.now(timezone.utc),
            saldo_pendiente=Decimal("550000.00"),
            cobrador=MockModel(nombre="Jorge Cobrador Terreno", cedula="98765432"),
            cliente=MockModel(nombres="Maria", apellidos="Gomez", cedula="1098765432", telefono="3119876543")
        ),
        cobrador=MockModel(nombre="Jorge Cobrador Terreno", cedula="98765432"),
        coordenadas_gps_cobro={"latitud": 8.7564, "longitud": -75.8841}
    )

    pdf_parcial_bytes = generar_pdf_recibo_abono(abono_parcial)
    name_parcial = construir_nombre_archivo_pdf("Abono_Parcial", abono_parcial.numero_contrato, abono_parcial.cliente_nombre, abono_parcial.fecha_pago)
    print(f"[OK] PDF Abono Parcial generado: {len(pdf_parcial_bytes)} bytes - Nombre: {name_parcial}")
    assert len(pdf_parcial_bytes) > 2000, "El PDF generado debe tener contenido valido"
    assert name_parcial.startswith("Abono_Parcial_CTR-PARC-002_Maria_Fernanda_Gomez"), f"Nombre inesperado: {name_parcial}"

    print("\n[SUCCESS] TODAS LAS PRUEBAS DE RECIBOS (TOTAL VS PARCIAL CON SALDO INSOLUTO) PASARON EXITOSAMENTE.")

if __name__ == "__main__":
    run_test()
