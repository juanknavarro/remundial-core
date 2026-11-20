#!/usr/bin/env python3
"""
=============================================================================
BOOTSTRAP DE INSTALACIÓN LIMPIA PARA NUEVOS CLIENTES (MARCA BLANCA)
=============================================================================
Script CLI idempotente para desplegar y preparar una nueva instancia del sistema
en blanco cuando se vende o alquila la plataforma a un nuevo cliente.

Responsabilidades:
1. Esquema Completo: Crea todos los tipos enumerados y las 11 tablas del ORM
   SQLAlchemy (incluyendo ventas_anuladas, cierres_caja, entidades_bancarias
   y detalles_transferencia) junto con índices y bancos predeterminados.
2. Superusuario Master: Inicializa el primer usuario Administrador con clave
   hasheada de forma segura (sin crear usuarios demo ni datos de prueba).
3. Configuración Marca Blanca Virgen: Genera el archivo config_parametros.json
   con la razón social, NIT, ciudad, lema y cláusulas legales genéricas
   (con protección estricta contra sobrescritura accidental).

Uso:
  python backend/scripts/bootstrap_instance.py --help
  python backend/scripts/bootstrap_instance.py --razon-social "Comercial El Sol S.A.S." --nit "900.123.456-7" --ciudad "Barranquilla, Atlántico"
=============================================================================
"""

import argparse
import asyncio
import getpass
import json
import os
import sys

# Asegurar que el directorio raíz de backend esté en el PYTHONPATH
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def generar_configuracion_virgen(
    razon_social: str,
    nit: str,
    ciudad: str,
    telefono: str,
) -> dict:
    """Genera la estructura de configuración institucional limpia para un nuevo cliente."""
    partes_ciudad = [p.strip() for p in ciudad.split(",") if p.strip()]
    nombre_ciudad = partes_ciudad[0] if partes_ciudad else ciudad
    departamento = partes_ciudad[1] if len(partes_ciudad) > 1 else "Principal"

    tel_display = telefono or "(+57) 300 000 0000"

    return {
        "empresa": {
            "razon_social": razon_social,
            "nit": nit,
            "ciudad_principal": ciudad,
            "telefono_soporte": telefono,
            "lema": "Soluciones comerciales y financiamiento transparente",
        },
        "identidad_visual": {
            "eslogan_login": "Plataforma Central de Crédito & Cobranza",
            "eslogan_mobile": "Operaciones de Venta y Cobranza en Terreno",
            "pie_login": "Acceso restringido únicamente a colaboradores autorizados.",
            "pie_mobile": f"{razon_social} • Operaciones de Campo",
            "tiene_logo": False,
            "logo_url": None,
        },
        "reglas_credito": {
            "plazos_permitidos": [9, 6, 4, 2],
            "unidad_plazo": "meses",
            "tipo_pago_defecto": "mensual",
            "dia_vencimiento": "ultimo_dia_mes",
            "umbral_mora_critica": 3,
            "descripcion_mora_critica": "Se clasifica en Cartera Crítica a partir de 3 cuotas vencidas (excluyendo créditos de 2 cuotas).",
            "cuota_inicial_minima": 0.0,
            "tasa_interes_incluida": True,
            "modalidad_proyeccion": "dinamica",
        },
        "sistema": {
            "version": "1.0.0",
            "ambiente": "Producción",
            "modulo_migracion_activo": True,
            "formato_migracion": "Excel (.xlsx Multi-Hoja)",
        },
        "ciudades_venta": {
            departamento: [nombre_ciudad]
        },
        "plantillas_pdf": {
            "membrete": {
                "razon_social": razon_social,
                "subtitulo": "Comercialización, Distribución & Ventas Financiadas",
                "nit": nit,
                "regimen": "Régimen Comercial",
                "ciudad": ciudad,
                "direccion": "Dirección Comercial Principal",
                "telefono_pbx": tel_display,
                "correo": "contacto@miempresa.com",
            },
            "clausulas_venta": (
                "<b>CLÁUSULAS GENERALES DE COMPRAVENTA Y FINANCIACIÓN:</b><br/>"
                "<b>1. Objeto y Recepción:</b> El CLIENTE adquiere a entera satisfacción los artículos y bienes descritos en este comprobante. "
                "<b>2. Pedidos y Fabricación:</b> Los bienes bajo encargo o especificación especial se alistan según los términos acordados; "
                "una vez iniciada la orden no se admiten cancelaciones unilaterales. "
                "<b>3. Plan de Pagos:</b> Las cuotas pactadas vencen puntualmente según la periodicidad acordada. "
                "Los abonos parciales reducen el saldo, y cualquier diferencia insoluta se arrastra a la siguiente exigibilidad sin alterar el plazo. "
                f"<b>4. Reserva de Dominio y Mérito Ejecutivo:</b> {razon_social} conserva la propiedad de los bienes hasta el pago total de la obligación. "
                "El presente documento presta mérito ejecutivo de conformidad con la legislación mercantil colombiana."
            ),
            "certificacion_recaudo": (
                "<b>CERTIFICACIÓN DE PAGO:</b> Este recibo digital certifica formalmente la recepción y registro del recaudo "
                f"en las cuentas de {razon_social}. La presente constancia amortiza el saldo del contrato especificado y queda "
                "asentada de manera inmutable en los libros auxiliares de cartera. Conserve este comprobante para cualquier conciliación contable."
            ),
            "acta_restitucion": {
                "clausula_legal": (
                    "<b>CLÁUSULA DE ENTREGA Y RESTITUCIÓN VOLUNTARIA DE BIENES:</b> En la fecha y hora señaladas en el encabezado, "
                    f"el CLIENTE / DEUDOR TITULAR hace entrega material, formal y pacífica a {razon_social} de los artículos descritos "
                    "en el inventario anterior, en aplicación estricta de las estipulaciones contractuales sobre reserva de dominio y "
                    "garantía mobiliaria pactadas en el contrato original de venta a crédito, motivado por la mora grave de tres (3) o más "
                    f"cuotas vencidas. {razon_social} recibe los bienes en calidad de custodia y para los trámites legales de avalúo, "
                    "liquidación y compensación del saldo deudor remanente. Ambas partes declaran haber verificado el estado físico de los "
                    "bienes retirados y estampan su consentimiento formal mediante firma digitalizada."
                ),
                "observaciones_defecto": "Departamento de Cartera y Recuperación de Bienes",
                "pie_pagina": "Diligencia ejecutada conforme al régimen de garantías mobiliarias y reserva de dominio contractual.",
            },
        },
    }


async def inicializar_esquema_bd() -> None:
    """Garantiza la creación de los tipos de datos, todas las 11 tablas del ORM e índices únicos."""
    print("\n[PASO 1/3] Sincronizando esquema de base de datos PostgreSQL...")
    from sqlalchemy import text
    from app.core.database import Base, engine
    from app.main import ensure_db_schema
    import app.models  # Registra los 11 modelos en Base.metadata

    # 1. Asegurar tipos enumerados en PostgreSQL si no existen
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rol_usuario_enum') THEN
                    CREATE TYPE rol_usuario_enum AS ENUM ('master', 'supervisor', 'vendedor', 'cobrador');
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_credito_enum') THEN
                    CREATE TYPE estado_credito_enum AS ENUM ('activo', 'saldado', 'incobrable', 'anulado');
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_pago_enum') THEN
                    CREATE TYPE tipo_pago_enum AS ENUM ('diario', 'semanal', 'quincenal', 'mensual');
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_abono_enum') THEN
                    CREATE TYPE estado_abono_enum AS ENUM ('registrado', 'conciliado', 'anulado');
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_referencia_enum') THEN
                    CREATE TYPE tipo_referencia_enum AS ENUM ('familiar', 'codeudor');
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_devolucion_enum') THEN
                    CREATE TYPE estado_devolucion_enum AS ENUM ('pendiente', 'aprobada', 'reembolsada', 'rechazada');
                END IF;
            END$$;
        """))

    # 2. Creación completa de las 11 tablas mapeadas por SQLAlchemy
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 3. Aplicar migraciones dinámicas de columnas, índices y catálogo bancario
    await ensure_db_schema()
    print("  ✔ Esquema completo y 11 tablas verificadas en PostgreSQL.")


async def inicializar_usuario_master(
    admin_nombre: str,
    admin_documento: str,
    admin_telefono: str,
    admin_password: str,
):
    """Crea el primer usuario Administrador Master si no existe previamente."""
    print("\n[PASO 2/3] Verificando cuenta de Administrador Master...")
    from sqlalchemy import select, or_
    from app.core.database import AsyncSessionLocal
    from app.core.security import get_password_hash
    from app.models.usuario import RolUsuario, Usuario

    identificador = admin_telefono or admin_documento or "3000000000"

    async with AsyncSessionLocal() as session:
        stmt = select(Usuario).where(
            or_(
                Usuario.telefono == identificador,
                Usuario.nombre == admin_nombre,
                Usuario.rol == RolUsuario.MASTER,
            )
        )
        res = await session.execute(stmt)
        usuario_existente = res.scalar_one_or_none()

        if usuario_existente:
            print(f"  ℹ Ya existe un Administrador en el sistema: '{usuario_existente.nombre}'")
            print(f"    (Identificador: {usuario_existente.telefono}, Rol: {usuario_existente.rol.value.upper()}).")
            print("    Se conserva intacto sin alterar su contraseña ni duplicar registros.")
            return usuario_existente

        nuevo_master = Usuario(
            nombre=admin_nombre,
            rol=RolUsuario.MASTER,
            telefono=identificador,
            password_hash=get_password_hash(admin_password),
            estado_activo=True,
        )
        session.add(nuevo_master)
        await session.commit()
        await session.refresh(nuevo_master)

        print("  ✔ Superusuario Master creado exitosamente:")
        print(f"    • Nombre:        {nuevo_master.nombre}")
        print(f"    • Rol:           {nuevo_master.rol.value.upper()}")
        print(f"    • Identificador: {nuevo_master.telefono}")
        print("    • Estado:        Activo")
        return nuevo_master


def inicializar_configuracion_json(
    razon_social: str,
    nit: str,
    ciudad: str,
    telefono: str,
    force_config: bool = False,
) -> bool:
    """Genera backend/storage/config_parametros.json con la identidad virgen del cliente."""
    print("\n[PASO 3/3] Configurando parámetros institucionales de Marca Blanca...")
    storage_dir = os.path.abspath(os.path.join(BACKEND_DIR, "storage"))
    os.makedirs(storage_dir, exist_ok=True)
    config_path = os.path.join(storage_dir, "config_parametros.json")

    if os.path.exists(config_path) and not force_config:
        print(f"  ℹ El archivo de configuración ya existe en:\n    {config_path}")
        print("    [PROTECCIÓN ACTIVA] No se sobrescribió para proteger los parámetros locales.")
        print("    (Para forzar su reemplazo, ejecute con la bandera --force-config).")
        return False

    config_data = generar_configuracion_virgen(
        razon_social=razon_social,
        nit=nit,
        ciudad=ciudad,
        telefono=telefono,
    )

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2, ensure_ascii=False)

    print(f"  ✔ Parámetros iniciales guardados con éxito en:\n    {config_path}")
    print(f"    • Razón Social: {razon_social}")
    print(f"    • NIT:          {nit}")
    print(f"    • Ciudad:       {ciudad}")
    return True


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bootstrap de Instalación Limpia para Nuevos Clientes (Marca Blanca Multi-Instancia).",
        formatter_class=argparse.RawTextHelpFormatter,
    )

    parser.add_argument(
        "--razon-social",
        type=str,
        help="Nombre comercial o razón social del nuevo cliente (ej. 'Comercial El Sol S.A.S.')",
    )
    parser.add_argument(
        "--nit",
        type=str,
        help="NIT de la empresa cliente (ej. '900.123.456-7')",
    )
    parser.add_argument(
        "--ciudad",
        type=str,
        help="Ciudad y departamento principal de operaciones (ej. 'Barranquilla, Atlántico')",
    )
    parser.add_argument(
        "--telefono",
        type=str,
        default="",
        help="Teléfono de contacto o PBX corporativo",
    )

    parser.add_argument(
        "--admin-nombre",
        type=str,
        help="Nombre del usuario Administrador Master (ej. 'Administrador Master')",
    )
    parser.add_argument(
        "--admin-documento",
        type=str,
        help="Cédula o documento del administrador",
    )
    parser.add_argument(
        "--admin-telefono",
        type=str,
        help="Teléfono celular del administrador (identificador para login)",
    )
    parser.add_argument(
        "--admin-password",
        type=str,
        help="Contraseña para el usuario Master (mínimo 6 caracteres)",
    )

    parser.add_argument(
        "--force-config",
        action="store_true",
        default=False,
        help="Forzar la sobrescritura de config_parametros.json si ya existe",
    )
    parser.add_argument(
        "--non-interactive",
        action="store_true",
        default=False,
        help="No solicitar datos interactivos; usar argumentos o valores predeterminados",
    )

    return parser.parse_args()


async def main_async(args: argparse.Namespace) -> None:
    print("=" * 76)
    print(" SISTEMA CORE - BOOTSTRAP DE NUEVA INSTANCIA (MARCA BLANCA)")
    print("=" * 76)

    is_interactive = sys.stdin.isatty() and not args.non_interactive

    # 1. Razón Social
    razon_social = args.razon_social
    if not razon_social:
        if is_interactive:
            razon_social = input("Razón social de la empresa [Comercializadora y Créditos S.A.S.]: ").strip()
        razon_social = razon_social or "Comercializadora y Créditos S.A.S."

    # 2. NIT
    nit = args.nit
    if not nit:
        if is_interactive:
            nit = input("NIT de la empresa [900.123.456-7]: ").strip()
        nit = nit or "900.123.456-7"

    # 3. Ciudad
    ciudad = args.ciudad
    if not ciudad:
        if is_interactive:
            ciudad = input("Ciudad y departamento principal [Ciudad Principal]: ").strip()
        ciudad = ciudad or "Ciudad Principal"

    # 4. Teléfono
    telefono = args.telefono
    if not telefono and is_interactive:
        telefono = input("Teléfono o PBX corporativo [300 000 0000]: ").strip()

    # 5. Administrador
    admin_nombre = args.admin_nombre
    if not admin_nombre:
        if is_interactive:
            admin_nombre = input("Nombre completo del Administrador Master [Superusuario Master]: ").strip()
        admin_nombre = admin_nombre or "Superusuario Master"

    admin_documento = args.admin_documento or ""
    if not admin_documento and is_interactive:
        admin_documento = input("Documento / Cédula del Administrador (opcional): ").strip()

    admin_telefono = args.admin_telefono
    if not admin_telefono:
        if is_interactive:
            admin_telefono = input("Teléfono celular del Administrador (identificador login) [3000000000]: ").strip()
        admin_telefono = admin_telefono or admin_documento or "3000000000"

    admin_password = args.admin_password
    if not admin_password:
        if is_interactive:
            while True:
                p1 = getpass.getpass("Contraseña para el usuario Master (mínimo 6 caracteres): ").strip()
                if len(p1) < 6:
                    print("⚠ La contraseña debe tener al menos 6 caracteres. Intente de nuevo.")
                    continue
                p2 = getpass.getpass("Confirme la contraseña: ").strip()
                if p1 != p2:
                    print("⚠ Las contraseñas no coinciden. Intente de nuevo.")
                    continue
                admin_password = p1
                break
        else:
            admin_password = "masterpassword123"

    # Ejecutar etapas del bootstrap
    await inicializar_esquema_bd()
    await inicializar_usuario_master(
        admin_nombre=admin_nombre,
        admin_documento=admin_documento,
        admin_telefono=admin_telefono,
        admin_password=admin_password,
    )
    inicializar_configuracion_json(
        razon_social=razon_social,
        nit=nit,
        ciudad=ciudad,
        telefono=telefono,
        force_config=args.force_config,
    )

    print("\n" + "=" * 76)
    print(" ✔ INSTALACIÓN Y BOOTSTRAP COMPLETADOS CON ÉXITO")
    print("=" * 76)
    print(f"Instancia lista para: {razon_social}")
    print(f"Login del Administrador: {admin_telefono}")
    print("La plataforma está lista para iniciar sin datos residuales ni marcas quemadas.\n")


def main() -> None:
    args = parse_arguments()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\n\nOperación cancelada por el usuario.")
        sys.exit(130)


if __name__ == "__main__":
    main()
