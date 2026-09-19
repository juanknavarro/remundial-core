import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
import io
import openpyxl
from decimal import Decimal
from datetime import date
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.credito import Credito
from app.models.cliente import Cliente
from app.models.usuario import Usuario, RolUsuario
from app.routers.configuracion import descargar_plantilla_migracion, procesar_migracion_masiva
from fastapi import UploadFile

async def test_excel():
    print("[TEST] Iniciando verificación de Plantilla e Importador Excel con Numero_Contrato y Ciudad_Venta...")

    # 1. Test Generador de Plantilla
    resp = await descargar_plantilla_migracion()
    assert resp.status_code == 200, "Error al generar plantilla"
    
    excel_bytes = resp.body
    wb = openpyxl.load_workbook(io.BytesIO(excel_bytes))
    
    assert "Creditos_Historicos" in wb.sheetnames, "Falta hoja Creditos_Historicos"
    assert "Instrucciones" in wb.sheetnames, "Falta hoja Instrucciones"
    
    ws_cred = wb["Creditos_Historicos"]
    headers_cred = [cell.value for cell in ws_cred[1] if cell.value is not None]
    print(f"[TEST 1 - PASS] Encabezados en Creditos_Historicos: {headers_cred}")
    assert "Numero_Contrato" in headers_cred, "Falta columna Numero_Contrato en cabecera"
    assert "Ciudad_Venta" in headers_cred, "Falta columna Ciudad_Venta en cabecera"
    
    # Validar filas de ejemplo
    row2_vals = [cell.value for cell in ws_cred[2]]
    print(f"[TEST 1 - PASS] Fila 2 de ejemplo en Creditos_Historicos: {row2_vals}")
    assert row2_vals[0] == "CTR-2025-1042", "Fila de ejemplo Numero_Contrato incorrecta"
    assert row2_vals[7] == "Montería", "Fila de ejemplo Ciudad_Venta incorrecta"

    # Validar Hoja 4 Instrucciones
    ws_ins = wb["Instrucciones"]
    instrucciones_text = [ws_ins.cell(row=r, column=2).value for r in range(5, 15)]
    print(f"[TEST 1 - PASS] Secciones en Instrucciones: {instrucciones_text}")
    assert any("Número de Contrato" in str(s) for s in instrucciones_text), "Falta instrucción de Número de Contrato"
    assert any("Ciudad de Venta" in str(s) for s in instrucciones_text), "Falta instrucción de Ciudad de Venta"

    # 2. Test Importador: Crear un libro Excel en memoria y pasarlo a importar_datos_masivos_excel
    async with AsyncSessionLocal() as session:
        # Asegurar un usuario supervisor/master para simular la sesión
        res_usr = await session.execute(select(Usuario).where(Usuario.rol.in_([RolUsuario.SUPERVISOR, RolUsuario.MASTER])).limit(1))
        current_user = res_usr.scalar_one_or_none()
        if not current_user:
            res_usr = await session.execute(select(Usuario).limit(1))
            current_user = res_usr.scalar_one_or_none()

        # Limpiar posibles créditos previos con este número de prueba
        test_contrato_excel = "MIG-EXCEL-TEST-9901"
        await session.execute(Credito.__table__.delete().where(Credito.numero_contrato == test_contrato_excel))
        await session.commit()

        # Asegurar cliente para la prueba
        test_cedula = "8877665544"
        res_cli = await session.execute(select(Cliente).where(Cliente.cedula == test_cedula))
        cli = res_cli.scalar_one_or_none()
        if not cli:
            cli = Cliente(
                cedula=test_cedula,
                nombres="Cliente Migracion Excel",
                telefono="3009988776",
                direccion="Calle 10 # 5-20",
                barrio="El Recreo",
                ciudad="Montería",
            )
            session.add(cli)
            await session.commit()

        # Construir libro de prueba con las 4 hojas
        wb_test = openpyxl.Workbook()
        ws1 = wb_test.active
        ws1.title = "Inventario"
        ws1.append(["Codigo_SKU", "Nombre_Articulo", "Precio_Base", "Existencias_Fisicas"])
        ws1.append(["TEST-SKU-01", "Mueble de Prueba", 150000, 10])

        ws2 = wb_test.create_sheet(title="Clientes_y_Referencias")
        ws2.append(["Cedula", "Nombres", "Telefono", "Direccion", "Barrio", "Ciudad", "Codeudor_Nombre", "Codeudor_Cedula", "Codeudor_Telefono", "Codeudor_Direccion", "Referencia_Nombre", "Referencia_Telefono", "Referencia_Parentesco", "Referencia_Direccion"])
        ws2.append([test_cedula, "Cliente Migracion Excel", "3009988776", "Calle 10 # 5-20", "El Recreo", "Montería", "", "", "", "", "", "", "", ""])

        ws3 = wb_test.create_sheet(title="Creditos_Historicos")
        ws3.append(["Numero_Contrato", "Cedula_Cliente", "Valor_Total", "Plazo_Cuotas", "Cuotas_Pagadas", "Saldo_Insoluto_Actual", "Fecha_Credito", "Ciudad_Venta", "Codigo_Articulo_SKU", "Cobrador_Asignado"])
        ws3.append([test_contrato_excel, test_cedula, 300000, 4, 1, 225000, "2026-01-10", "Sincelejo", "TEST-SKU-01", ""])

        ws4 = wb_test.create_sheet(title="Instrucciones")

        buffer_test = io.BytesIO()
        wb_test.save(buffer_test)
        buffer_test.seek(0)

        upload_file = UploadFile(
            file=buffer_test,
            filename="Test_Migracion.xlsx",
        )

        res_import = await procesar_migracion_masiva(
            file=upload_file,
            db=session,
            current_user=current_user
        )

        print(f"[TEST 2 - PASS] Resultado importación: {res_import.get('resumen')}")
        assert res_import.get("success") is True, f"Importación falló: {res_import}"
        assert res_import["resumen"]["creditos_creados"] >= 1, "No se creó el crédito"

        # Verificar en base de datos
        res_db = await session.execute(select(Credito).where(Credito.numero_contrato == test_contrato_excel))
        cred_db = res_db.scalar_one_or_none()
        assert cred_db is not None, "El crédito no se encontró en PostgreSQL con el numero_contrato esperado"
        assert cred_db.numero_contrato == test_contrato_excel, "El numero_contrato no coincide"
        assert cred_db.ciudad_venta == "Sincelejo", f"ciudad_venta esperada 'Sincelejo', obtenida '{cred_db.ciudad_venta}'"
        print(f"[TEST 2 - PASS] Crédito verificado en BD: ID={cred_db.id_contrato}, Contrato={cred_db.numero_contrato}, Ciudad={cred_db.ciudad_venta}")

        # Limpiar
        await session.delete(cred_db)
        await session.commit()
        print("[TEST] Limpieza completada con éxito.")

    print("\n¡TODAS LAS PRUEBAS DE MIGRACIÓN EXCEL PASARON EXITOSAMENTE (2/2)!")

if __name__ == "__main__":
    asyncio.run(test_excel())
