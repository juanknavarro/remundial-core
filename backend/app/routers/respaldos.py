import enum
import json
import logging
import os
import re
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import Date, DateTime, Numeric, delete, func, select
from sqlalchemy.schema import FetchedValue

from app.core.database import Base, get_db
from app.core.deps import get_user_from_header_or_query
from app.models.abono import Abono, CierreCaja
from app.models.cliente import Cliente, ReferenciaCliente
from app.models.credito import Credito, CreditoDetalle
from app.models.usuario import RolUsuario, Usuario
import app.models  # noqa: F401 - Asegura el registro íntegro de todos los modelos ORM en Base.metadata

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/respaldos", tags=["Respaldos & Copias de Seguridad"])

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "storage")
CONFIG_FILE_PATH = os.path.join(STORAGE_DIR, "config_parametros.json")


def _obtener_empresa_slug() -> str:
    """Extrae y sanitiza el nombre comercial de la empresa desde config_parametros.json para nombres de archivo."""
    razon_social = "remundial"
    if os.path.exists(CONFIG_FILE_PATH):
        try:
            with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                rs = cfg.get("empresa", {}).get("razon_social")
                if rs and isinstance(rs, str) and rs.strip():
                    razon_social = rs.strip()
        except Exception:
            pass
    # Sanitizar: minúsculas, espacios a guiones bajos y eliminar caracteres especiales
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", razon_social.lower()).strip("_")
    return slug or "remundial"


def custom_json_encoder(obj: Any) -> Any:
    """Serializador universal para tipos devueltos por SQLAlchemy, PostgreSQL y PostGIS."""
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, (datetime, date, time)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, enum.Enum):
        return obj.value
    if isinstance(obj, (bytes, bytearray, memoryview)):
        try:
            return bytes(obj).decode("utf-8")
        except Exception:
            return bytes(obj).hex()
    # Soporte para tipos geométricos WKBElement / geoalchemy2 / asyncpg.Point
    if hasattr(obj, "data") and hasattr(obj, "srid"):
        return str(obj)
    if hasattr(obj, "x") and hasattr(obj, "y"):
        return {"longitud": float(obj.x), "latitud": float(obj.y)}
    if hasattr(obj, "__geo_interface__"):
        return obj.__geo_interface__
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict") and callable(obj.dict):
        return obj.dict()
    return str(obj)


def coerce_row_data(table, row_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Sanea y convierte los valores deserializados de JSON a los tipos nativos esperados por asyncpg."""
    clean_row: Dict[str, Any] = {}
    for col in table.columns:
        # Omitir columnas calculadas/generadas por el motor de base de datos (ej. subtotal STORED en credito_detalle)
        if type(col.server_default) is FetchedValue or getattr(col, "computed", None) is not None:
            continue
        if col.name not in row_dict:
            continue
        val = row_dict[col.name]
        if val is None:
            clean_row[col.name] = None
            continue

        if isinstance(col.type, DateTime):
            if isinstance(val, str):
                try:
                    clean_row[col.name] = datetime.fromisoformat(val)
                except Exception:
                    clean_row[col.name] = val
            else:
                clean_row[col.name] = val
        elif isinstance(col.type, Date):
            if isinstance(val, str):
                try:
                    clean_row[col.name] = date.fromisoformat(val[:10])
                except Exception:
                    clean_row[col.name] = val
            else:
                clean_row[col.name] = val
        elif isinstance(col.type, Numeric):
            if isinstance(val, (int, float, str)):
                try:
                    clean_row[col.name] = Decimal(str(val))
                except Exception:
                    clean_row[col.name] = val
            else:
                clean_row[col.name] = val
        else:
            clean_row[col.name] = val

    return clean_row


@router.get(
    "/exportar",
    summary="Exportar volcado dinámico de base de datos en formato JSON",
    description=(
        "Extrae dinámicamente todas las tablas registradas en SQLAlchemy mediante Base.metadata.sorted_tables, "
        "respetando el orden de dependencias de llaves foráneas (Foreign Keys) para facilitar restauraciones."
    ),
    status_code=status.HTTP_200_OK,
)
async def exportar_respaldo_completo(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_user_from_header_or_query),
) -> Response:
    """Extrae todos los registros de cada tabla y los devuelve como un archivo JSON descargable."""
    if current_user.rol not in (RolUsuario.MASTER, RolUsuario.SUPERVISOR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren privilegios de Administrador o Supervisor para exportar copias de seguridad.",
        )

    volcado: Dict[str, List[Dict[str, Any]]] = {}

    # Base.metadata.sorted_tables ordena las tablas según la jerarquía de llaves foráneas
    for table in Base.metadata.sorted_tables:
        stmt = table.select()
        res = await db.execute(stmt)
        filas = res.mappings().all()
        volcado[table.name] = [dict(row) for row in filas]

    # Serialización a JSON con indentación legible y codificador personalizado
    json_str = json.dumps(
        volcado,
        default=custom_json_encoder,
        ensure_ascii=False,
        indent=2,
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    empresa_slug = _obtener_empresa_slug()
    filename = f"backup_{empresa_slug}_{timestamp}.json"

    return Response(
        content=json_str,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get(
    "/resumen",
    summary="Obtener métricas y recuento de registros por tabla",
    description="Permite a la interfaz administrativa visualizar el número de tablas y filas antes de descargar.",
    status_code=status.HTTP_200_OK,
)
async def resumen_respaldo_tablas(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_user_from_header_or_query),
) -> Dict[str, Any]:
    """Retorna las tablas registradas y el conteo de filas de cada una."""
    if current_user.rol not in (RolUsuario.MASTER, RolUsuario.SUPERVISOR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren privilegios de Administrador o Supervisor.",
        )

    resumen_tablas: List[Dict[str, Any]] = []
    total_registros = 0

    for table in Base.metadata.sorted_tables:
        count_stmt = select(func.count()).select_from(table)
        count_res = await db.execute(count_stmt)
        filas_count = count_res.scalar_one_or_none() or 0
        total_registros += filas_count
        resumen_tablas.append({
            "tabla": table.name,
            "columnas": len(table.columns),
            "registros": filas_count,
        })

    return {
        "total_tablas": len(Base.metadata.sorted_tables),
        "total_registros": total_registros,
        "tablas": resumen_tablas,
        "fecha": datetime.now().isoformat(),
    }


@router.post(
    "/restaurar",
    summary="Restaurar base de datos a partir de archivo de respaldo JSON con seguridad transaccional",
    description=(
        "Sobrescribe completamente la base de datos actual con los registros provistos en el archivo JSON. "
        "Aplica una transacción atómica estricta (rollback automático si surge algún error), "
        "limpieza en orden inverso de dependencias foráneas (reversed(Base.metadata.sorted_tables)) "
        "e inserción en orden normal de jerarquías relacionales."
    ),
    status_code=status.HTTP_200_OK,
)
async def restaurar_respaldo_completo(
    file: UploadFile = File(..., description="Archivo de respaldo JSON generado por el sistema"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_user_from_header_or_query),
) -> Dict[str, Any]:
    """Restaura la base de datos de manera atómica a partir de un volcado JSON."""
    if current_user.rol not in (RolUsuario.MASTER, RolUsuario.SUPERVISOR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren privilegios de Administrador o Supervisor para restaurar copias de seguridad.",
        )

    # Validar extensión del archivo
    if not (file.filename and file.filename.lower().endswith(".json")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo proporcionado debe tener extensión .json.",
        )

    # Leer y decodificar el contenido JSON
    try:
        contenido_bytes = await file.read()
        datos_respaldo = json.loads(contenido_bytes.decode("utf-8"))
    except Exception as e:
        logger.error(f"Error decodificando archivo JSON de respaldo: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se pudo decodificar el archivo JSON: {str(e)}",
        )

    if not isinstance(datos_respaldo, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estructura de respaldo inválida. El archivo raíz debe ser un objeto JSON con tablas.",
        )

    # Si la sesión ya tiene una transacción activa de lectura (iniciada por deps de auth),
    # cerramos ese contexto para que async with db.begin() sea el bloque maestro transaccional.
    if db.in_transaction():
        await db.commit()

    tablas_procesadas: Dict[str, int] = {}
    total_insertados = 0

    try:
        # Bloque transaccional estricto con rollback automático garantizado
        async with db.begin():
            # Paso A (Limpieza): Itera en orden inverso respetando Foreign Keys
            for table in reversed(Base.metadata.sorted_tables):
                await db.execute(table.delete())

            # Paso B (Inserción): Itera en orden normal respetando dependencias
            for table in Base.metadata.sorted_tables:
                if table.name in datos_respaldo and isinstance(datos_respaldo[table.name], list) and datos_respaldo[table.name]:
                    filas_json = datos_respaldo[table.name]
                    registros_limpios = [
                        coerce_row_data(table, fila)
                        for fila in filas_json
                        if isinstance(fila, dict)
                    ]
                    if registros_limpios:
                        await db.execute(table.insert().values(registros_limpios))
                        tablas_procesadas[table.name] = len(registros_limpios)
                        total_insertados += len(registros_limpios)
                    else:
                        tablas_procesadas[table.name] = 0
                else:
                    tablas_procesadas[table.name] = 0

    except Exception as e:
        logger.error(f"Error crítico durante la restauración de respaldo: {e}", exc_info=True)
        # async with db.begin() ya efectúa rollback automáticamente ante cualquier excepción
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                f"Error durante la restauración transaccional: {str(e)}. "
                "Se aplicó rollback automático y la base de datos se mantiene intacta."
            ),
        )

    return {
        "success": True,
        "mensaje": "Base de datos restaurada exitosamente con seguridad transaccional.",
        "total_tablas": len(Base.metadata.sorted_tables),
        "total_registros": total_insertados,
        "detalles": tablas_procesadas,
        "fecha": datetime.now().isoformat(),
    }


@router.post(
    "/hard-reset-dev",
    summary="Limpieza total de datos de prueba para entorno de desarrollo (Hard Reset)",
    description=(
        "Elimina en cascada transaccional y orden referencial estricto: cierres_caja, abonos, "
        "credito_detalle, creditos, referencias_cliente y clientes. Preserva intactas las tablas de "
        "usuarios (autenticación) y productos (catálogo/inventario base)."
    ),
)
async def hard_reset_dev(
    db: AsyncSession = Depends(get_db),
    usuario_auth: Optional[Usuario] = Depends(get_user_from_header_or_query),
) -> Dict[str, Any]:
    """Ejecuta una limpieza completa de datos transaccionales respetando foreign keys."""
    # Si la sesión tiene una transacción abierta previa, cerrarla para un bloque maestro
    if db.in_transaction():
        await db.commit()

    registros_eliminados: Dict[str, int] = {}
    try:
        async with db.begin():
            # 1. cierres_caja (elimina cierres antes o después de abonos)
            res_cierres = await db.execute(delete(CierreCaja))
            registros_eliminados["cierres_caja"] = res_cierres.rowcount if res_cierres.rowcount is not None and res_cierres.rowcount >= 0 else 0

            # 2. abonos (recaudos en terreno)
            res_abonos = await db.execute(delete(Abono))
            registros_eliminados["abonos"] = res_abonos.rowcount if res_abonos.rowcount is not None and res_abonos.rowcount >= 0 else 0

            # 3. credito_detalle (líneas de artículos por contrato)
            res_detalles = await db.execute(delete(CreditoDetalle))
            registros_eliminados["credito_detalle"] = res_detalles.rowcount if res_detalles.rowcount is not None and res_detalles.rowcount >= 0 else 0

            # 4. creditos (contratos de crédito y contado)
            res_creditos = await db.execute(delete(Credito))
            registros_eliminados["creditos"] = res_creditos.rowcount if res_creditos.rowcount is not None and res_creditos.rowcount >= 0 else 0

            # 5. referencias_cliente (codeudores y familiares de respaldo)
            res_refs = await db.execute(delete(ReferenciaCliente))
            registros_eliminados["referencias_cliente"] = res_refs.rowcount if res_refs.rowcount is not None and res_refs.rowcount >= 0 else 0

            # 6. clientes (directorio de clientes titulares)
            res_clientes = await db.execute(delete(Cliente))
            registros_eliminados["clientes"] = res_clientes.rowcount if res_clientes.rowcount is not None and res_clientes.rowcount >= 0 else 0

        logger.info(
            f"[HARD RESET DEV] Limpieza ejecutada exitosamente. Registros eliminados: {registros_eliminados} "
            f"por usuario {getattr(usuario_auth, 'nombre', 'Anónimo/Dev')}"
        )

    except Exception as e:
        logger.error(f"[HARD RESET DEV] Error durante el vaciado de tablas: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                f"Error al ejecutar Hard Reset: {str(e)}. "
                "Se aplicó rollback y no se modificaron los registros."
            ),
        )

    total_vacios = sum(registros_eliminados.values())

    return {
        "success": True,
        "mensaje": f"Hard Reset completado con éxito. Se eliminaron {total_vacios} registros transaccionales sin afectar usuarios ni productos.",
        "eliminados": registros_eliminados,
        "tablas_conservadas": ["usuarios", "productos"],
        "fecha": datetime.now().isoformat(),
    }
