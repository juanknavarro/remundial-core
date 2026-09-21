import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal
import io
import json
import os
import time
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, get_user_from_header_or_query, require_supervisor
from app.models.cliente import Cliente, ReferenciaCliente, TipoReferenciaEnum
from app.models.credito import Credito, CreditoDetalle, EstadoCredito, TipoPago
from app.models.producto import Producto
from app.models.usuario import RolUsuario, Usuario
from app.schemas.credito import calcular_fecha_vencimiento
from app.services.pdf_recibo import DEFAULT_CONFIG_PDF, obtener_configuracion_pdf

router = APIRouter(
    prefix="/configuracion",
    tags=["Configuración & Migración"],
)

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "storage")
CONFIG_FILE_PATH = os.path.join(STORAGE_DIR, "config_parametros.json")
LOGO_FILE_PATH = os.path.join(STORAGE_DIR, "logo_institucional.png")


class ActualizarEmpresaRequest(BaseModel):
    razon_social: Optional[str] = Field(None, max_length=150)
    nit: Optional[str] = Field(None, max_length=50)
    ciudad_principal: Optional[str] = Field(None, max_length=100)
    telefono_soporte: Optional[str] = Field(None, max_length=50)
    lema: Optional[str] = Field(None, max_length=255)


class MembretePdfRequest(BaseModel):
    razon_social: Optional[str] = Field(None, max_length=150)
    subtitulo: Optional[str] = Field(None, max_length=200)
    nit: Optional[str] = Field(None, max_length=50)
    regimen: Optional[str] = Field(None, max_length=100)
    direccion: Optional[str] = Field(None, max_length=200)
    ciudad: Optional[str] = Field(None, max_length=100)
    telefono_pbx: Optional[str] = Field(None, max_length=100)
    correo: Optional[str] = Field(None, max_length=100)


class ActaRestitucionPdfRequest(BaseModel):
    clausula_legal: Optional[str] = None
    observaciones_defecto: Optional[str] = None
    pie_pagina: Optional[str] = None


class PlantillasPdfRequest(BaseModel):
    membrete: Optional[MembretePdfRequest] = None
    clausulas_venta: Optional[str] = None
    certificacion_recaudo: Optional[str] = None
    acta_restitucion: Optional[ActaRestitucionPdfRequest] = None


class IdentidadVisualRequest(BaseModel):
    eslogan_login: Optional[str] = Field(None, max_length=200)
    eslogan_mobile: Optional[str] = Field(None, max_length=200)
    pie_login: Optional[str] = Field(None, max_length=300)
    pie_mobile: Optional[str] = Field(None, max_length=300)


DEFAULT_CIUDADES_VENTA: Dict[str, List[str]] = {
    "Córdoba": [
        "Montería",
        "Ayapel",
        "Buenavista",
        "Canalete",
        "Cereté",
        "Chimá",
        "Chinú",
        "Ciénaga de Oro",
        "Cotorra",
        "La Apartada",
        "Lorica",
        "Los Córdobas",
        "Momil",
        "Montelíbano",
        "Moñitos",
        "Planeta Rica",
        "Pueblo Nuevo",
        "Puerto Escondido",
        "Puerto Libertador",
        "Purísima",
        "Sahagún",
        "San Andrés de Sotavento",
        "San Antero",
        "San Bernardo del Viento",
        "San Carlos",
        "San José de Uré",
        "San Pelayo",
        "Tierralta",
        "Tuchín",
        "Valencia",
    ],
    "Sucre": [
        "Sincelejo",
        "Buenavista",
        "Caimito",
        "Colosó",
        "Corozal",
        "Coveñas",
        "Chalán",
        "El Roble",
        "Galeras",
        "Guaranda",
        "La Unión",
        "Los Palmitos",
        "Majagual",
        "Morroa",
        "Ovejas",
        "Palmito",
        "Sampués",
        "San Benito Abad",
        "San Juan de Betulia",
        "San Marcos",
        "San Onofre",
        "San Pedro",
        "Sincé",
        "Sucre",
        "Tolú",
        "Toluviejo",
    ],
}


class CiudadesVentaRequest(BaseModel):
    ciudades: Optional[Any] = Field(None, description="Estructura de ciudades o lista plana autorizada")
    departamentos: Optional[Dict[str, List[str]]] = Field(None, description="Diccionario estructurado por departamento")


class AgregarCiudadRequest(BaseModel):
    departamento: Optional[str] = Field("Córdoba", description="Departamento al que pertenece el municipio (ej. Córdoba, Sucre)")
    ciudad: str = Field(..., min_length=2, max_length=100, description="Nombre de la ciudad o municipio a agregar")


def _obtener_ciudades_venta() -> Dict[str, List[str]]:
    """Obtiene el catálogo estructurado de departamentos y municipios autorizados."""
    params = _obtener_parametros_locales()
    raw = params.get("ciudades_venta")
    if isinstance(raw, dict):
        resultado: Dict[str, List[str]] = {}
        for dep, munis in raw.items():
            if isinstance(munis, list):
                clean_munis = []
                for m in munis:
                    m_str = str(m).strip()
                    if m_str and m_str not in clean_munis:
                        clean_munis.append(m_str)
                if clean_munis:
                    resultado[str(dep).strip()] = clean_munis
        if resultado:
            return resultado

    # Si viene en formato plano legacy (lista de strings) o vacío
    resultado = {k: list(v) for k, v in DEFAULT_CIUDADES_VENTA.items()}
    if isinstance(raw, list):
        sucre_ref = {s.lower() for s in DEFAULT_CIUDADES_VENTA["Sucre"]}
        for item in raw:
            item_str = str(item).strip()
            if not item_str:
                continue
            if item_str.lower() in sucre_ref:
                if item_str not in resultado["Sucre"]:
                    resultado["Sucre"].append(item_str)
            else:
                if item_str not in resultado["Córdoba"]:
                    resultado["Córdoba"].append(item_str)
    return resultado


def _guardar_ciudades_venta(ciudades: Any) -> Dict[str, List[str]]:
    """Persiste el catálogo estructurado de ciudades de venta en el archivo de configuración."""
    if isinstance(ciudades, dict):
        resultado: Dict[str, List[str]] = {}
        for dep, munis in ciudades.items():
            dep_clean = str(dep).strip()
            if isinstance(munis, list):
                clean_munis = []
                for m in munis:
                    m_str = str(m).strip()
                    if m_str and m_str not in clean_munis:
                        clean_munis.append(m_str)
                if clean_munis:
                    resultado[dep_clean] = clean_munis
    elif isinstance(ciudades, list):
        resultado = {k: list(v) for k, v in DEFAULT_CIUDADES_VENTA.items()}
        sucre_ref = {s.lower() for s in DEFAULT_CIUDADES_VENTA["Sucre"]}
        for item in ciudades:
            item_str = str(item).strip()
            if not item_str:
                continue
            if item_str.lower() in sucre_ref:
                if item_str not in resultado["Sucre"]:
                    resultado["Sucre"].append(item_str)
            else:
                if item_str not in resultado["Córdoba"]:
                    resultado["Córdoba"].append(item_str)
    else:
        resultado = {k: list(v) for k, v in DEFAULT_CIUDADES_VENTA.items()}

    if not resultado:
        resultado = {k: list(v) for k, v in DEFAULT_CIUDADES_VENTA.items()}

    current = _obtener_parametros_locales()
    current["ciudades_venta"] = resultado
    os.makedirs(os.path.dirname(CONFIG_FILE_PATH), exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)
    return resultado


def _obtener_parametros_locales() -> Dict[str, Any]:
    """Carga los parámetros operativos y reglas de negocio vigentes."""
    defaults = {
        "empresa": {
            "razon_social": "Remundial Arte's S.A.S.",
            "nit": "901.458.789-2",
            "ciudad_principal": "Montería, Córdoba",
            "telefono_soporte": "3189998877",
            "lema": "El arte a tu alcance con financiamiento transparente",
        },
        "identidad_visual": {
            "eslogan_login": "Plataforma Central de Crédito & Cobranza",
            "eslogan_mobile": "Plataforma Central de Campo & Cobranza",
            "pie_login": "Acceso restringido únicamente a colaboradores autorizados de Remundial.",
            "pie_mobile": "Remundial Core v1.2.0 • Operaciones de Campo",
            "tiene_logo": os.path.exists(LOGO_FILE_PATH),
            "logo_url": f"/configuracion/logo?t={int(os.path.getmtime(LOGO_FILE_PATH))}" if os.path.exists(LOGO_FILE_PATH) else None,
        },
        "reglas_credito": {
            "plazos_permitidos": [2, 4, 6, 9],
            "unidad_plazo": "meses",
            "tipo_pago_defecto": "mensual",
            "dia_vencimiento": "ultimo_dia_mes",
            "umbral_mora_critica": 3,
            "descripcion_mora_critica": "Se clasifica en Cartera Crítica a partir de 3 cuotas vencidas (excluyendo créditos de 2 cuotas).",
            "cuota_inicial_minima": 0.0,
            "tasa_interes_incluida": True,
        },
        "sistema": {
            "version": "1.2.0",
            "ambiente": "Producción Local",
            "modulo_migracion_activo": True,
            "formato_migracion": "Excel (.xlsx Multi-Hoja)",
        },
        "ciudades_venta": {k: list(v) for k, v in DEFAULT_CIUDADES_VENTA.items()},
        "plantillas_pdf": obtener_configuracion_pdf(),
    }
    if os.path.exists(CONFIG_FILE_PATH):
        try:
            with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                defaults.update(saved)
                if "identidad_visual" in saved:
                    defaults["identidad_visual"].update(saved["identidad_visual"])
        except Exception:
            pass
    # Verificar dinámicamente si el archivo de logo existe en el sistema
    tiene_logo = os.path.exists(LOGO_FILE_PATH)
    defaults["identidad_visual"]["tiene_logo"] = tiene_logo
    defaults["identidad_visual"]["logo_url"] = (
        f"/configuracion/logo?t={int(os.path.getmtime(LOGO_FILE_PATH))}" if tiene_logo else None
    )
    return defaults


def _guardar_parametros_locales(nuevos_datos: Dict[str, Any]) -> Dict[str, Any]:
    """Actualiza y persiste los parámetros institucionales en storage/config_parametros.json."""
    current = _obtener_parametros_locales()
    if "empresa" in nuevos_datos and isinstance(nuevos_datos["empresa"], dict):
        current["empresa"].update({k: v for k, v in nuevos_datos["empresa"].items() if v is not None})
    else:
        for field in ["razon_social", "nit", "ciudad_principal", "telefono_soporte", "lema"]:
            if field in nuevos_datos and nuevos_datos[field] is not None:
                current["empresa"][field] = nuevos_datos[field]

    os.makedirs(os.path.dirname(CONFIG_FILE_PATH), exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)
    return current


def _guardar_plantillas_pdf(datos: PlantillasPdfRequest) -> Dict[str, Any]:
    """Actualiza y persiste los textos y membretes de documentos PDF en storage/config_parametros.json."""
    current = _obtener_parametros_locales()
    if "plantillas_pdf" not in current or not isinstance(current["plantillas_pdf"], dict):
        current["plantillas_pdf"] = obtener_configuracion_pdf()

    p_pdf = current["plantillas_pdf"]
    if datos.membrete:
        m_dict = {k: v for k, v in datos.membrete.model_dump().items() if v is not None}
        p_pdf["membrete"].update(m_dict)
        # Sincronizar datos de empresa con membrete si se actualizaron
        if "empresa" in current and isinstance(current["empresa"], dict):
            if "razon_social" in m_dict and m_dict["razon_social"]:
                current["empresa"]["razon_social"] = m_dict["razon_social"]
            if "nit" in m_dict:
                current["empresa"]["nit"] = m_dict["nit"]
            if "ciudad" in m_dict and m_dict["ciudad"]:
                current["empresa"]["ciudad_principal"] = m_dict["ciudad"]
            if "telefono_pbx" in m_dict and m_dict["telefono_pbx"]:
                current["empresa"]["telefono_soporte"] = m_dict["telefono_pbx"]

    if datos.clausulas_venta is not None:
        p_pdf["clausulas_venta"] = datos.clausulas_venta
    if datos.certificacion_recaudo is not None:
        p_pdf["certificacion_recaudo"] = datos.certificacion_recaudo
    if datos.acta_restitucion:
        acta_dict = {k: v for k, v in datos.acta_restitucion.model_dump().items() if v is not None}
        p_pdf["acta_restitucion"].update(acta_dict)

    os.makedirs(os.path.dirname(CONFIG_FILE_PATH), exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)

    return current["plantillas_pdf"]


@router.get(
    "/parametros",
    summary="Obtener parámetros generales y reglas de negocio del sistema",
    status_code=status.HTTP_200_OK,
)
async def obtener_parametros(
    current_user: Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    """Retorna las políticas operativas, reglas de plazos (2, 4, 6, 9 cuotas) y datos institucionales."""
    return _obtener_parametros_locales()


@router.put(
    "/parametros",
    summary="Actualizar parámetros institucionales y datos de la empresa",
    status_code=status.HTTP_200_OK,
)
async def actualizar_parametros(
    datos: ActualizarEmpresaRequest,
    current_user: Usuario = Depends(require_supervisor),
) -> Dict[str, Any]:
    """Permite al supervisor o administrador actualizar Razón Social, NIT, Sede y Línea de Atención."""
    nuevos = {k: v for k, v in datos.model_dump().items() if v is not None}
    resultado = _guardar_parametros_locales(nuevos)
    return {
        "success": True,
        "mensaje": "Identidad de la compañía actualizada correctamente.",
        "parametros": resultado,
    }


@router.get(
    "/plantillas-pdf",
    summary="Obtener configuración centralizada de membretes, cláusulas y textos PDF",
    status_code=status.HTTP_200_OK,
)
async def obtener_plantillas_pdf(
    current_user: Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    """Retorna los textos y membretes configurados para los recibos POS, abonos y actas de restitución."""
    return obtener_configuracion_pdf()


@router.put(
    "/plantillas-pdf",
    summary="Actualizar configuración y textos de documentos PDF",
    status_code=status.HTTP_200_OK,
)
async def actualizar_plantillas_pdf(
    datos: PlantillasPdfRequest,
    current_user: Usuario = Depends(require_supervisor),
) -> Dict[str, Any]:
    """Guarda y sincroniza los textos de membrete, cláusulas comerciales y certificaciones legales para ReportLab."""
    pdf_config = _guardar_plantillas_pdf(datos)
    return {
        "success": True,
        "mensaje": "Configuración de documentos y textos PDF guardada y sincronizada exitosamente.",
        "plantillas_pdf": pdf_config,
    }


@router.get(
    "/identidad-publica",
    summary="Obtener identidad institucional pública para login web y app móvil",
    status_code=status.HTTP_200_OK,
)
async def obtener_identidad_publica() -> Dict[str, Any]:
    """Retorna los datos de marca, logotipo y textos de pie de página para usuarios no autenticados."""
    params = _obtener_parametros_locales()
    emp = params.get("empresa", {})
    vis = params.get("identidad_visual", {})
    tiene_logo = os.path.exists(LOGO_FILE_PATH)
    logo_ts = int(os.path.getmtime(LOGO_FILE_PATH)) if tiene_logo else 0
    return {
        "razon_social": emp.get("razon_social", "REMUNDIAL ARTE'S"),
        "subtitulo": params.get("plantillas_pdf", {}).get("membrete", {}).get("subtitulo", "Mueblería, Artesanías, Mecedoras & Cuadros por Encargo"),
        "lema": emp.get("lema", "El arte a tu alcance con financiamiento transparente"),
        "eslogan_login": vis.get("eslogan_login", "Plataforma Central de Crédito & Cobranza"),
        "eslogan_mobile": vis.get("eslogan_mobile", "Plataforma Central de Campo & Cobranza"),
        "pie_login": vis.get("pie_login", "Acceso restringido únicamente a colaboradores autorizados de Remundial."),
        "pie_mobile": vis.get("pie_mobile", "Remundial Core v1.2.0 • Operaciones de Campo"),
        "tiene_logo": tiene_logo,
        "logo_url": f"/configuracion/logo?t={logo_ts}" if tiene_logo else None,
    }


@router.get(
    "/ciudades",
    summary="Obtener catálogo estructurado de departamentos y municipios de venta",
    status_code=status.HTTP_200_OK,
)
async def obtener_ciudades():
    """Retorna la lista de localidades organizadas por departamento (Córdoba, Sucre)."""
    ciudades = _obtener_ciudades_venta()
    lista_plana = []
    for munis in ciudades.values():
        for m in munis:
            if m not in lista_plana:
                lista_plana.append(m)
    total = sum(len(m) for m in ciudades.values())
    return {
        "success": True,
        "departamentos": ciudades,
        "ciudades": ciudades,
        "ciudades_plano": lista_plana,
        "total": total,
    }


@router.put(
    "/ciudades",
    summary="Actualizar catálogo completo de ciudades operativas de venta",
    status_code=status.HTTP_200_OK,
)
async def actualizar_ciudades(
    datos: CiudadesVentaRequest,
    current_user: Usuario = Depends(require_supervisor),
):
    """Permite al supervisor o administrador actualizar el catálogo de municipios autorizados."""
    payload = datos.departamentos if datos.departamentos is not None else datos.ciudades
    ciudades = _guardar_ciudades_venta(payload)
    lista_plana = []
    for munis in ciudades.values():
        for m in munis:
            if m not in lista_plana:
                lista_plana.append(m)
    total = sum(len(m) for m in ciudades.values())
    return {
        "success": True,
        "mensaje": "Catálogo de ciudades operativas actualizado exitosamente.",
        "departamentos": ciudades,
        "ciudades": ciudades,
        "ciudades_plano": lista_plana,
        "total": total,
    }


@router.post(
    "/ciudades",
    summary="Agregar una nueva ciudad operativa de venta",
    status_code=status.HTTP_200_OK,
)
async def agregar_ciudad(
    datos: AgregarCiudadRequest,
    current_user: Usuario = Depends(require_supervisor),
):
    """Permite registrar una nueva localidad comercial en el departamento correspondiente."""
    ciudad_nueva = datos.ciudad.strip().title()
    dep = (datos.departamento or "Córdoba").strip().title()
    if "Sucre" in dep:
        dep = "Sucre"
    elif "Cordoba" in dep or "Córdoba" in dep:
        dep = "Córdoba"

    ciudades_actuales = _obtener_ciudades_venta()
    if dep not in ciudades_actuales:
        ciudades_actuales[dep] = []

    if any(c.lower() == ciudad_nueva.lower() for c in ciudades_actuales[dep]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El municipio '{ciudad_nueva}' ya se encuentra registrado en {dep}.",
        )
    ciudades_actuales[dep].append(ciudad_nueva)
    resultado = _guardar_ciudades_venta(ciudades_actuales)
    lista_plana = []
    for munis in resultado.values():
        for m in munis:
            if m not in lista_plana:
                lista_plana.append(m)
    return {
        "success": True,
        "mensaje": f"Municipio '{ciudad_nueva}' agregado exitosamente a {dep}.",
        "departamentos": resultado,
        "ciudades": resultado,
        "ciudades_plano": lista_plana,
        "total": sum(len(m) for m in resultado.values()),
    }


@router.delete(
    "/ciudades/{ciudad}",
    summary="Eliminar una ciudad operativa de venta",
    status_code=status.HTTP_200_OK,
)
async def eliminar_ciudad(
    ciudad: str,
    current_user: Usuario = Depends(require_supervisor),
):
    """Permite remover una localidad del catálogo activo de ciudades permitidas."""
    ciudad_limpia = ciudad.strip().lower()
    ciudades_actuales = _obtener_ciudades_venta()
    encontrado = False
    for dep, munis in list(ciudades_actuales.items()):
        nuevas = [c for c in munis if c.lower() != ciudad_limpia]
        if len(nuevas) != len(munis):
            encontrado = True
            ciudades_actuales[dep] = nuevas

    if not encontrado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"La ciudad '{ciudad}' no fue encontrada en el catálogo activo.",
        )
    resultado = _guardar_ciudades_venta(ciudades_actuales)
    lista_plana = []
    for munis in resultado.values():
        for m in munis:
            if m not in lista_plana:
                lista_plana.append(m)
    return {
        "success": True,
        "mensaje": f"Ciudad '{ciudad}' eliminada exitosamente.",
        "departamentos": resultado,
        "ciudades": resultado,
        "ciudades_plano": lista_plana,
        "total": sum(len(m) for m in resultado.values()),
    }


@router.get(
    "/logo",
    summary="Descargar o visualizar el logotipo oficial institucional",
)
async def obtener_logo():
    """Sirve la imagen del logotipo institucional oficial con encabezados anti-caché."""
    if not os.path.exists(LOGO_FILE_PATH):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se ha configurado un logotipo institucional personalizado.",
        )
    return FileResponse(
        LOGO_FILE_PATH,
        media_type="image/png",
        headers={
            "Cache-Control": "no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


@router.post(
    "/logo",
    summary="Subir logotipo institucional oficial (PNG, JPG, SVG, WebP)",
    status_code=status.HTTP_200_OK,
)
async def subir_logo(
    file: UploadFile = File(...),
    current_user: Usuario = Depends(require_supervisor),
) -> Dict[str, Any]:
    """Permite al supervisor cargar un archivo de logotipo corporativo."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    allowed_exts = [".png", ".jpg", ".jpeg", ".webp", ".svg"]
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Formato no permitido ({ext}). Se recomienda PNG transparente o JPG/WEBP/SVG.",
        )

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo supera el tamaño máximo permitido de 5 MB.",
        )

    os.makedirs(STORAGE_DIR, exist_ok=True)
    with open(LOGO_FILE_PATH, "wb") as f:
        f.write(contents)

    params = _obtener_parametros_locales()
    if "identidad_visual" not in params:
        params["identidad_visual"] = {}
    params["identidad_visual"]["tiene_logo"] = True
    params["identidad_visual"]["logo_url"] = "/configuracion/logo"
    params["identidad_visual"]["logo_nombre"] = file.filename
    params["identidad_visual"]["updated_at"] = int(time.time())

    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(params, f, ensure_ascii=False, indent=2)

    return {
        "success": True,
        "mensaje": "Logotipo institucional actualizado exitosamente.",
        "logo_url": f"/configuracion/logo?t={int(time.time())}",
    }


@router.delete(
    "/logo",
    summary="Restaurar logotipo al ícono por defecto del sistema",
    status_code=status.HTTP_200_OK,
)
async def eliminar_logo(
    current_user: Usuario = Depends(require_supervisor),
) -> Dict[str, Any]:
    """Elimina el logotipo personalizado y restaura el ícono corporativo estándar."""
    if os.path.exists(LOGO_FILE_PATH):
        try:
            os.remove(LOGO_FILE_PATH)
        except Exception:
            pass

    params = _obtener_parametros_locales()
    if "identidad_visual" in params:
        params["identidad_visual"]["tiene_logo"] = False
        params["identidad_visual"]["logo_url"] = None
        params["identidad_visual"]["logo_nombre"] = None
        params["identidad_visual"]["updated_at"] = int(time.time())

        with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(params, f, ensure_ascii=False, indent=2)

    return {
        "success": True,
        "mensaje": "Logotipo personalizado eliminado. Se restauró el ícono corporativo estándar.",
    }


@router.put(
    "/identidad-visual",
    summary="Actualizar eslóganes y textos de pie de página para Login Web y App Móvil",
    status_code=status.HTTP_200_OK,
)
async def actualizar_identidad_visual(
    datos: IdentidadVisualRequest,
    current_user: Usuario = Depends(require_supervisor),
) -> Dict[str, Any]:
    """Permite al supervisor personalizar los textos de acceso que ven los colaboradores."""
    params = _obtener_parametros_locales()
    if "identidad_visual" not in params:
        params["identidad_visual"] = {}

    for k, v in datos.model_dump().items():
        if v is not None:
            params["identidad_visual"][k] = v

    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(params, f, ensure_ascii=False, indent=2)

    return {
        "success": True,
        "mensaje": "Textos de identidad visual para Login Web y Móvil guardados con éxito.",
        "identidad_visual": params["identidad_visual"],
    }


@router.get(
    "/plantilla-migracion-excel",
    summary="Descargar Plantilla Oficial Excel (.xlsx) para Migración y Cargue Masivo",
    status_code=status.HTTP_200_OK,
)
async def descargar_plantilla_migracion(
    current_user: Usuario = Depends(get_user_from_header_or_query),
):
    """Genera y descarga el archivo Excel oficial (.xlsx) de 4 hojas estructurado con formato estricto y ejemplos reales."""
    wb = openpyxl.Workbook()

    # Paleta de Estilos Profesionales Remundial Pro
    font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    font_title = Font(name="Calibri", size=14, bold=True, color="0F172A")
    font_subtitle = Font(name="Calibri", size=10, italic=True, color="475569")
    font_bold = Font(name="Calibri", size=10, bold=True, color="0F172A")
    font_data = Font(name="Calibri", size=10, color="1E293B")
    font_example = Font(name="Calibri", size=10, italic=True, color="334155")

    fill_header = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")  # Slate 900
    fill_example = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")  # Slate 100
    fill_instruction_box = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

    thin_border_side = Side(style="thin", color="CBD5E1")
    border_cell = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)

    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")

    # -------------------------------------------------------------
    # HOJA 1: Inventario (Estrictamente: Codigo_SKU, Descripcion, Precio_Base, Stock_Inicial)
    # -------------------------------------------------------------
    ws_inv = wb.active
    ws_inv.title = "Inventario"
    ws_inv.views.sheetView[0].showGridLines = True

    headers_inv = [
        ("Codigo_SKU", 18, align_center, "@"),
        ("Descripcion", 48, align_left, "@"),
        ("Precio_Base", 18, align_right, "$#,##0"),
        ("Stock_Inicial", 16, align_right, "#,##0"),
    ]

    for col_idx, (h_name, width, align, num_fmt) in enumerate(headers_inv, start=1):
        cell = ws_inv.cell(row=1, column=col_idx, value=h_name)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_cell
        ws_inv.column_dimensions[get_column_letter(col_idx)].width = width

    ws_inv.row_dimensions[1].height = 28

    # Filas de ejemplo real sin columna Categoría
    ejemplos_inv = [
        ("ART-001", "Cuadro al Óleo Lienzo 120x80cm Paisaje Marino Atardecer", 450000, 15),
        ("ART-002", "Cuadro Religioso Virgen del Carmen Marco Dorado 70x50cm", 280000, 20),
        ("ART-003", "Tríptico Abstracto Moderno Texturizado Acrílico", 520000, 8),
    ]

    for r_idx, row_data in enumerate(ejemplos_inv, start=2):
        ws_inv.row_dimensions[r_idx].height = 22
        for c_idx, val in enumerate(row_data, start=1):
            cell = ws_inv.cell(row=r_idx, column=c_idx, value=val)
            cell.font = font_example
            cell.fill = fill_example
            cell.border = border_cell
            cell.alignment = headers_inv[c_idx - 1][2]
            cell.number_format = headers_inv[c_idx - 1][3]

    # -------------------------------------------------------------
    # HOJA 2: Clientes_y_Referencias
    # -------------------------------------------------------------
    ws_cli = wb.create_sheet(title="Clientes_y_Referencias")
    ws_cli.views.sheetView[0].showGridLines = True

    headers_cli = [
        ("Cedula", 18, align_center, "@"),
        ("Nombres", 32, align_left, "@"),
        ("Telefono", 18, align_center, "@"),
        ("Direccion", 30, align_left, "@"),
        ("Barrio", 20, align_left, "@"),
        ("Ciudad", 18, align_left, "@"),
        ("Codeudor_Nombre", 30, align_left, "@"),
        ("Codeudor_Cedula", 18, align_center, "@"),
        ("Codeudor_Telefono", 18, align_center, "@"),
        ("Codeudor_Direccion", 30, align_left, "@"),
        ("Referencia_Nombre", 30, align_left, "@"),
        ("Referencia_Telefono", 18, align_center, "@"),
        ("Referencia_Parentesco", 20, align_left, "@"),
        ("Referencia_Direccion", 30, align_left, "@"),
    ]

    for col_idx, (h_name, width, align, num_fmt) in enumerate(headers_cli, start=1):
        cell = ws_cli.cell(row=1, column=col_idx, value=h_name)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_cell
        ws_cli.column_dimensions[get_column_letter(col_idx)].width = width

    ws_cli.row_dimensions[1].height = 28

    ejemplos_cli = [
        (
            "1065823411", "María Camila Rodríguez Torres", "3114567890", "Calle 14 # 23-45", "La Granja", "Montería",
            "Carlos Andrés Rodríguez", "1065998877", "3123456789", "Carrera 5 # 12-30",
            "Gloria Inés Torres", "3109876543", "Madre", "Calle 14 # 23-45",
        ),
        (
            "1067234589", "Jorge Eliécer Morales Mendoza", "3145556677", "Manzana B Lote 8", "Cantaclaro", "Montería",
            "Sandra Patricia Morales", "1068991122", "3134449900", "Calle 25 # 8-12",
            "Luis Alberto Morales", "3201112233", "Hermano", "Diagonal 12 # 4-10",
        ),
    ]

    for r_idx, row_data in enumerate(ejemplos_cli, start=2):
        ws_cli.row_dimensions[r_idx].height = 22
        for c_idx, val in enumerate(row_data, start=1):
            cell = ws_cli.cell(row=r_idx, column=c_idx, value=val)
            cell.font = font_example
            cell.fill = fill_example
            cell.border = border_cell
            cell.alignment = headers_cli[c_idx - 1][2]
            cell.number_format = headers_cli[c_idx - 1][3]

    # -------------------------------------------------------------
    # HOJA 3: Creditos_Historicos
    # -------------------------------------------------------------
    ws_cred = wb.create_sheet(title="Creditos_Historicos")
    ws_cred.views.sheetView[0].showGridLines = True

    headers_cred = [
        ("Numero_Contrato", 20, align_center, "@"),
        ("Cedula_Cliente", 18, align_center, "@"),
        ("Valor_Total", 18, align_right, "$#,##0"),
        ("Plazo_Cuotas", 16, align_center, "#,##0"),
        ("Cuotas_Pagadas", 16, align_center, "#,##0"),
        ("Saldo_Insoluto_Actual", 22, align_right, "$#,##0"),
        ("Fecha_Credito", 18, align_center, "yyyy-mm-dd"),
        ("Departamento_Venta", 20, align_center, "@"),
        ("Municipio_Venta", 22, align_center, "@"),
        ("Codigo_Articulo_SKU", 22, align_center, "@"),
        ("Cobrador_Asignado", 28, align_center, "@"),
    ]

    for col_idx, (h_name, width, align, num_fmt) in enumerate(headers_cred, start=1):
        cell = ws_cred.cell(row=1, column=col_idx, value=h_name)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_cell
        ws_cred.column_dimensions[get_column_letter(col_idx)].width = width

    ws_cred.row_dimensions[1].height = 28

    # Ejemplos reales con Numero_Contrato, Departamento_Venta, Municipio_Venta y Cobrador_Asignado opcional
    ejemplos_cred = [
        ("CTR-2025-1042", "1065823411", 600000, 6, 2, 400000, "2026-01-15", "Córdoba", "Montería", "ART-001", "Carlos Cobrador"),
        ("CTR-2026-0089", "1067234589", 450000, 4, 1, 337500, "2026-02-10", "Sucre", "Sincelejo", "ART-002", "1065998877"),
    ]

    for r_idx, row_data in enumerate(ejemplos_cred, start=2):
        ws_cred.row_dimensions[r_idx].height = 22
        for c_idx, val in enumerate(row_data, start=1):
            cell = ws_cred.cell(row=r_idx, column=c_idx, value=val)
            cell.font = font_example
            cell.fill = fill_example
            cell.border = border_cell
            cell.alignment = headers_cred[c_idx - 1][2]
            cell.number_format = headers_cred[c_idx - 1][3]

    # Validación de datos para Plazo_Cuotas en Hoja 3 (Solo 2, 4, 6 o 9) - Columna D
    dv_plazos = DataValidation(
        type="list",
        formula1='"2,4,6,9"',
        allow_blank=False,
        error="Plazo inválido. Remundial maneja exclusivamente 2, 4, 6 o 9 cuotas mensuales.",
        errorTitle="Error de Plazo Contractual",
        prompt="Seleccione 2, 4, 6 o 9 cuotas mensuales",
        promptTitle="Plazos Autorizados",
    )
    ws_cred.add_data_validation(dv_plazos)
    dv_plazos.add("D2:D5000")

    # Validación de lista para Departamento_Venta en Hoja 3 - Columna H (Córdoba, Sucre)
    dv_departamentos = DataValidation(
        type="list",
        formula1='"Córdoba,Sucre"',
        allow_blank=True,
        error="Seleccione Córdoba o Sucre de la lista desplegable autorizada.",
        errorTitle="Departamento Inválido",
        prompt="Seleccione el departamento correspondiente (Córdoba o Sucre)",
        promptTitle="Departamento de Venta",
    )
    ws_cred.add_data_validation(dv_departamentos)
    dv_departamentos.add("H2:H5000")

    # Ayuda contextual para Municipio_Venta en Hoja 3 - Columna I
    dv_municipios = DataValidation(
        type="custom",
        formula1="TRUE",
        allow_blank=True,
        prompt="Ingrese el municipio comercial (ej: Montería, Cereté, Lorica, Sincelejo, Corozal)",
        promptTitle="Municipio Comercial",
    )
    ws_cred.add_data_validation(dv_municipios)
    dv_municipios.add("I2:I5000")

    # -------------------------------------------------------------
    # HOJA 4: Instrucciones
    # -------------------------------------------------------------
    ws_ins = wb.create_sheet(title="Instrucciones")
    ws_ins.views.sheetView[0].showGridLines = True
    ws_ins.column_dimensions["A"].width = 6
    ws_ins.column_dimensions["B"].width = 24
    ws_ins.column_dimensions["C"].width = 75

    ws_ins.merge_cells("B2:C2")
    c_title = ws_ins["B2"]
    c_title.value = "GUÍA OFICIAL DE CARGUE MASIVO E IMPORTACIÓN HÍBRIDA"
    c_title.font = font_title
    c_title.alignment = align_left

    ws_ins.merge_cells("B3:C3")
    c_sub = ws_ins["B3"]
    c_sub.value = "Remundial Core Pro • Sistema de Gestión de Créditos y Cobranza"
    c_sub.font = font_subtitle
    c_sub.alignment = align_left

    instrucciones_data = [
        ("1. Estructura del Libro", "No cambie los nombres ni el orden de las 4 hojas del archivo. El sistema reconoce automáticamente 'Inventario', 'Clientes_y_Referencias' y 'Creditos_Historicos'."),
        ("2. Hoja 'Inventario'", "Diligencie los códigos SKU únicos, descripciones, precio base y existencias físicas iniciales (sin columna de categoría). Si un producto ya existe en catálogo, el sistema sumará el stock sin duplicar el registro."),
        ("3. Hoja 'Clientes'", "La Cédula es la clave primaria de vinculación. Debe ingresar los datos obligatorios del cliente y sus contactos de respaldo (Codeudor solidario y Referencia familiar)."),
        ("4. Número de Contrato (Opcional)", "En 'Numero_Contrato' puede registrar el folio, número de talonario físico o código del contrato original de su sistema anterior (ej. CTR-2025-1042 o 0451). Si se deja vacío, el sistema autogenerará un identificador único seguro. Si se especifica, debe ser único en el sistema."),
        ("5. Ubicación Geográfica (Dpto y Municipio)", "En 'Departamento_Venta' elija Córdoba o Sucre (validación desplegable). En 'Municipio_Venta' ingrese la ciudad o municipio comercial (ej: Montería, Cereté, Lorica, Sincelejo, Corozal). Si se deja vacío, el sistema tomará automáticamente la ciudad registrada del cliente titular y su respectivo departamento."),
        ("6. Regla de Plazos (Estricta)", "En la columna 'Plazo_Cuotas' solo se permiten exactamente 2, 4, 6 o 9 cuotas mensuales. Cualquier otro valor detendrá la importación de esa fila."),
        ("7. Fechas Históricas Reales", "En 'Fecha_Credito' ingrese la fecha real en que nació el crédito (formato AAAA-MM-DD o formato fecha estándar). El sistema respetará dicha fecha original sin forzar recálculos retroactivos erróneos."),
        ("8. Saldo Insoluto y Cuotas", "Indique las 'Cuotas_Pagadas' y el 'Saldo_Insoluto_Actual'. Si el crédito ya está liquidado (saldo 0), el sistema lo registrará automáticamente como 'terminado'."),
        ("9. Asignación de Cobrador (Opcional)", "En 'Cobrador_Asignado' puede ingresar el documento (cédula), teléfono o nombre del cobrador ya existente en el sistema. Si se deja vacío o no coincide, el crédito quedará listo para asignación de ruta posterior desde Cartera."),
        ("10. Idempotencia y Seguridad", "El cargue es transaccional. Las filas de ejemplo sombreadas en gris pueden ser borradas o reemplazadas por sus registros reales."),
    ]

    for idx, (seccion, detalle) in enumerate(instrucciones_data, start=5):
        ws_ins.row_dimensions[idx].height = 36
        cell_sec = ws_ins.cell(row=idx, column=2, value=seccion)
        cell_sec.font = font_bold
        cell_sec.fill = fill_instruction_box
        cell_sec.border = border_cell
        cell_sec.alignment = align_left

        cell_det = ws_ins.cell(row=idx, column=3, value=detalle)
        cell_det.font = font_data
        cell_det.fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
        cell_det.border = border_cell
        cell_det.alignment = align_left

    # Guardar en buffer en memoria
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = "Plantilla_Migracion_Remundial_Core.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.post(
    "/migracion-masiva",
    summary="Procesar e importar masivamente plantilla Excel diligenciada (Inventario, Clientes y Créditos)",
    status_code=status.HTTP_200_OK,
)
async def procesar_migracion_masiva(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
) -> Dict[str, Any]:
    """Valida, procesa y migra transaccionalmente productos, clientes con garantías y créditos históricos con fechas y saldos reales."""
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de archivo no admitido. Debe cargar un archivo Excel en formato .xlsx válido.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo proporcionado está vacío.",
        )

    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No fue posible leer el archivo Excel: {str(e)}",
        )

    sheet_names_lower = {name.lower().strip(): name for name in wb.sheetnames}

    # Resolver hojas flexiblemente
    name_inv = next((orig for low, orig in sheet_names_lower.items() if "inventario" in low or "producto" in low), None)
    name_cli = next((orig for low, orig in sheet_names_lower.items() if "cliente" in low), None)
    name_cred = next((orig for low, orig in sheet_names_lower.items() if "credito" in low), None)

    if not name_cli or not name_cred:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo Excel debe contener al menos las hojas 'Clientes_y_Referencias' y 'Creditos_Historicos'.",
        )

    errores: List[Dict[str, Any]] = []
    resumen = {
        "inventario_procesados": 0,
        "inventario_creados": 0,
        "inventario_actualizados": 0,
        "clientes_procesados": 0,
        "clientes_creados": 0,
        "clientes_actualizados": 0,
        "creditos_procesados": 0,
        "creditos_creados": 0,
        "creditos_omitidos": 0,
    }

    # -------------------------------------------------------------
    # 1. Procesar Hoja 1 (Inventario)
    # -------------------------------------------------------------
    productos_creados_map: Dict[str, Producto] = {}
    if name_inv:
        ws_inv = wb[name_inv]
        # Mapear columnas de encabezado
        headers = [cell.value for cell in ws_inv[1] if cell.value is not None]
        header_map = {str(h).strip().lower(): idx for idx, h in enumerate(headers, start=1)}

        col_sku = header_map.get("codigo_sku") or header_map.get("sku") or 1
        col_desc = header_map.get("descripcion") or header_map.get("nombre") or 2
        col_prec = header_map.get("precio_base") or header_map.get("precio") or (4 if "categoria" in header_map else 3)
        col_stock = header_map.get("stock_inicial") or header_map.get("stock") or (5 if "categoria" in header_map else 4)

        for row_idx in range(2, ws_inv.max_row + 1):
            raw_sku = ws_inv.cell(row=row_idx, column=col_sku).value
            raw_desc = ws_inv.cell(row=row_idx, column=col_desc).value
            if raw_sku is None and raw_desc is None:
                continue

            sku = str(raw_sku or "").strip().upper()
            if not sku:
                continue

            resumen["inventario_procesados"] += 1
            desc = str(raw_desc or f"Artículo {sku}").strip()
            raw_prec = ws_inv.cell(row=row_idx, column=col_prec).value
            raw_stock = ws_inv.cell(row=row_idx, column=col_stock).value

            try:
                precio_base = Decimal(str(raw_prec or 0)) if raw_prec is not None else Decimal("100000.00")
            except Exception:
                precio_base = Decimal("100000.00")

            try:
                stock_ini = int(raw_stock or 0) if raw_stock is not None else 0
            except Exception:
                stock_ini = 0

            # Buscar en base de datos
            res = await db.execute(select(Producto).where(Producto.sku == sku))
            prod_db = res.scalar_one_or_none()

            if prod_db:
                prod_db.stock += stock_ini
                if desc and len(desc) > 3:
                    prod_db.nombre = desc
                if precio_base > 0:
                    prod_db.precio_base = precio_base
                prod_db.estado_activo = True
                productos_creados_map[sku] = prod_db
                resumen["inventario_actualizados"] += 1
            else:
                nuevo_prod = Producto(
                    sku=sku,
                    nombre=desc,
                    precio_base=precio_base if precio_base > 0 else Decimal("100000.00"),
                    stock=max(0, stock_ini),
                    maneja_stock=True,
                    estado_activo=True,
                )
                db.add(nuevo_prod)
                productos_creados_map[sku] = nuevo_prod
                resumen["inventario_creados"] += 1

        await db.flush()

    # -------------------------------------------------------------
    # 2. Procesar Hoja 2 (Clientes_y_Referencias)
    # -------------------------------------------------------------
    ws_cli = wb[name_cli]
    headers_cli = [cell.value for cell in ws_cli[1] if cell.value is not None]
    h_cli_map = {str(h).strip().lower(): idx for idx, h in enumerate(headers_cli, start=1)}

    col_ced = h_cli_map.get("cedula") or 1
    col_nom = h_cli_map.get("nombres") or h_cli_map.get("nombre") or 2
    col_tel = h_cli_map.get("telefono") or 3
    col_dir = h_cli_map.get("direccion") or 4
    col_bar = h_cli_map.get("barrio") or 5
    col_ciu = h_cli_map.get("ciudad") or 6

    col_cod_nom = h_cli_map.get("codeudor_nombre") or 7
    col_cod_ced = h_cli_map.get("codeudor_cedula") or 8
    col_cod_tel = h_cli_map.get("codeudor_telefono") or 9
    col_cod_dir = h_cli_map.get("codeudor_direccion") or 10

    col_ref_nom = h_cli_map.get("referencia_nombre") or 11
    col_ref_tel = h_cli_map.get("referencia_telefono") or 12
    col_ref_par = h_cli_map.get("referencia_parentesco") or 13
    col_ref_dir = h_cli_map.get("referencia_direccion") or 14

    clientes_procesados_map: Dict[str, Cliente] = {}

    for row_idx in range(2, ws_cli.max_row + 1):
        raw_ced = ws_cli.cell(row=row_idx, column=col_ced).value
        raw_nom = ws_cli.cell(row=row_idx, column=col_nom).value

        if raw_ced is None and raw_nom is None:
            continue

        cedula = str(raw_ced or "").strip()
        nombres = str(raw_nom or "").strip()

        if not cedula or not nombres:
            errores.append({
                "hoja": "Clientes_y_Referencias",
                "fila": row_idx,
                "motivo": "Cédula y Nombres son obligatorios.",
            })
            continue

        resumen["clientes_procesados"] += 1
        tel = str(ws_cli.cell(row=row_idx, column=col_tel).value or "").strip() or None
        direc = str(ws_cli.cell(row=row_idx, column=col_dir).value or "").strip() or "Dirección no registrada"
        barrio = str(ws_cli.cell(row=row_idx, column=col_bar).value or "").strip() or None
        ciudad = str(ws_cli.cell(row=row_idx, column=col_ciu).value or "").strip() or "Montería"

        # Buscar cliente existente en BD
        res_cli = await db.execute(select(Cliente).where(Cliente.cedula == cedula))
        cli_db = res_cli.scalar_one_or_none()

        if cli_db:
            cli_db.nombres = nombres
            if tel:
                cli_db.telefono = tel
            if direc != "Dirección no registrada":
                cli_db.direccion = direc
            if barrio:
                cli_db.barrio = barrio
            if ciudad:
                cli_db.ciudad = ciudad
            clientes_procesados_map[cedula] = cli_db
            resumen["clientes_actualizados"] += 1
            cliente_target = cli_db
        else:
            nuevo_cli = Cliente(
                cedula=cedula,
                nombres=nombres,
                telefono=tel,
                direccion=direc,
                barrio=barrio,
                ciudad=ciudad,
            )
            db.add(nuevo_cli)
            await db.flush()
            clientes_procesados_map[cedula] = nuevo_cli
            resumen["clientes_creados"] += 1
            cliente_target = nuevo_cli

        # Datos del Codeudor
        cod_nom = str(ws_cli.cell(row=row_idx, column=col_cod_nom).value or "").strip()
        if cod_nom:
            cod_ced = str(ws_cli.cell(row=row_idx, column=col_cod_ced).value or "").strip() or None
            cod_tel = str(ws_cli.cell(row=row_idx, column=col_cod_tel).value or "").strip() or None
            cod_dir = str(ws_cli.cell(row=row_idx, column=col_cod_dir).value or "").strip() or None

            ref_codeudor = ReferenciaCliente(
                cliente_id=cliente_target.id,
                tipo=TipoReferenciaEnum.CODEUDOR,
                nombre=cod_nom,
                cedula=cod_ced,
                telefono=cod_tel,
                direccion=cod_dir,
            )
            db.add(ref_codeudor)

        # Datos de la Referencia Familiar
        ref_nom = str(ws_cli.cell(row=row_idx, column=col_ref_nom).value or "").strip()
        if ref_nom:
            ref_tel = str(ws_cli.cell(row=row_idx, column=col_ref_tel).value or "").strip() or None
            ref_par = str(ws_cli.cell(row=row_idx, column=col_ref_par).value or "").strip() or "Familiar"
            ref_dir = str(ws_cli.cell(row=row_idx, column=col_ref_dir).value or "").strip()

            dir_compuesta = f"Parentesco: {ref_par}"
            if ref_dir:
                dir_compuesta += f" • {ref_dir}"

            ref_familiar = ReferenciaCliente(
                cliente_id=cliente_target.id,
                tipo=TipoReferenciaEnum.FAMILIAR,
                nombre=ref_nom,
                telefono=ref_tel,
                direccion=dir_compuesta,
            )
            db.add(ref_familiar)

    await db.flush()

    # -------------------------------------------------------------
    # 3. Procesar Hoja 3 (Creditos_Historicos)
    # -------------------------------------------------------------
    ws_cred = wb[name_cred]
    headers_cred = [cell.value for cell in ws_cred[1] if cell.value is not None]
    h_cred_map = {str(h).strip().lower(): idx for idx, h in enumerate(headers_cred, start=1)}

    col_cr_num = h_cred_map.get("numero_contrato") or h_cred_map.get("contrato") or h_cred_map.get("folio")
    col_cr_ced = h_cred_map.get("cedula_cliente") or h_cred_map.get("cedula") or (2 if col_cr_num == 1 else 1)
    col_cr_val = h_cred_map.get("valor_total") or h_cred_map.get("monto_total") or (3 if col_cr_num == 1 else 2)
    col_cr_plz = h_cred_map.get("plazo_cuotas") or h_cred_map.get("plazo") or (4 if col_cr_num == 1 else 3)
    col_cr_pag = h_cred_map.get("cuotas_pagadas") or (5 if col_cr_num == 1 else 4)
    col_cr_sal = h_cred_map.get("saldo_insoluto_actual") or h_cred_map.get("saldo_pendiente") or (6 if col_cr_num == 1 else 5)
    col_cr_fec = h_cred_map.get("fecha_credito") or h_cred_map.get("fecha") or (7 if col_cr_num == 1 else 6)
    col_cr_dep = h_cred_map.get("departamento_venta") or h_cred_map.get("departamento") or h_cred_map.get("depto")
    col_cr_ciu = h_cred_map.get("municipio_venta") or h_cred_map.get("ciudad_venta") or h_cred_map.get("ciudad") or h_cred_map.get("municipio")
    col_cr_sku = h_cred_map.get("codigo_articulo_sku") or h_cred_map.get("sku") or (10 if col_cr_num == 1 else 7)
    col_cr_cob = h_cred_map.get("cobrador_asignado") or h_cred_map.get("cobrador") or (11 if col_cr_num == 1 else 8)

    contratos_procesados_set = set()

    # Asegurar producto comodín para créditos migrados sin SKU de catálogo
    res_mighist = await db.execute(select(Producto).where(Producto.sku == "MIG-HIST"))
    prod_mig_hist = res_mighist.scalar_one_or_none()
    if not prod_mig_hist:
        prod_mig_hist = Producto(
            sku="MIG-HIST",
            nombre="Artículo de Cartera Migrada",
            precio_base=Decimal("100000.00"),
            stock=9999,
            maneja_stock=False,
            estado_activo=True,
        )
        db.add(prod_mig_hist)
        await db.flush()

    # Cargar cobradores activos para resolución rápida por documento/cédula, teléfono o nombre
    res_cobs = await db.execute(select(Usuario).where(Usuario.rol == RolUsuario.COBRADOR, Usuario.estado_activo == True))
    cobradores_disponibles = res_cobs.scalars().all()
    cobradores_lookup = {}
    for cob in cobradores_disponibles:
        if cob.telefono:
            cobradores_lookup[cob.telefono.strip()] = cob.id
            cobradores_lookup[cob.telefono.strip().replace(" ", "")] = cob.id
        if cob.nombre:
            cobradores_lookup[cob.nombre.strip().lower()] = cob.id
        if hasattr(cob, "cedula") and getattr(cob, "cedula", None):
            cobradores_lookup[str(cob.cedula).strip()] = cob.id

    PLAZOS_VALIDOS = (2, 4, 6, 9)

    for row_idx in range(2, ws_cred.max_row + 1):
        raw_ced = ws_cred.cell(row=row_idx, column=col_cr_ced).value
        raw_val = ws_cred.cell(row=row_idx, column=col_cr_val).value

        if raw_ced is None and raw_val is None:
            continue

        cedula_cli = str(raw_ced or "").strip()
        if not cedula_cli:
            continue

        resumen["creditos_procesados"] += 1

        # 1. Validar existencia del cliente
        cliente_obj = clientes_procesados_map.get(cedula_cli)
        if not cliente_obj:
            res_c = await db.execute(select(Cliente).where(Cliente.cedula == cedula_cli))
            cliente_obj = res_c.scalar_one_or_none()

        if not cliente_obj:
            errores.append({
                "hoja": "Creditos_Historicos",
                "fila": row_idx,
                "motivo": f"El cliente con cédula '{cedula_cli}' no existe en el sistema ni en la hoja de Clientes.",
            })
            resumen["creditos_omitidos"] += 1
            continue

        # 2. Validar plazo estricto (2, 4, 6 o 9)
        raw_plz = ws_cred.cell(row=row_idx, column=col_cr_plz).value
        try:
            plazo_int = int(raw_plz or 0)
        except Exception:
            plazo_int = 0

        if plazo_int not in PLAZOS_VALIDOS:
            errores.append({
                "hoja": "Creditos_Historicos",
                "fila": row_idx,
                "motivo": f"Plazo inválido '{raw_plz}' para el cliente {cedula_cli}. Debe ser 2, 4, 6 o 9 cuotas mensuales.",
            })
            resumen["creditos_omitidos"] += 1
            continue

        # 3. Validar Valor Total y Saldo Insoluto
        try:
            valor_total = Decimal(str(raw_val or 0))
        except Exception:
            valor_total = Decimal("0.00")

        if valor_total <= Decimal("0.00"):
            errores.append({
                "hoja": "Creditos_Historicos",
                "fila": row_idx,
                "motivo": f"Valor total inválido '{raw_val}' para el crédito de {cedula_cli}.",
            })
            resumen["creditos_omitidos"] += 1
            continue

        valor_cuota = round(valor_total / plazo_int, 2)

        raw_pag = ws_cred.cell(row=row_idx, column=col_cr_pag).value
        try:
            cuotas_pag = int(raw_pag or 0)
        except Exception:
            cuotas_pag = 0

        raw_sal = ws_cred.cell(row=row_idx, column=col_cr_sal).value
        if raw_sal is not None and str(raw_sal).strip():
            try:
                saldo_insoluto = Decimal(str(raw_sal))
            except Exception:
                saldo_insoluto = max(Decimal("0.00"), valor_total - (Decimal(cuotas_pag) * valor_cuota))
        else:
            saldo_insoluto = max(Decimal("0.00"), valor_total - (Decimal(cuotas_pag) * valor_cuota))

        # 4. Validar Fecha Real del Crédito
        raw_fec = ws_cred.cell(row=row_idx, column=col_cr_fec).value
        fecha_real = date.today()
        if isinstance(raw_fec, (datetime, date)):
            fecha_real = raw_fec.date() if isinstance(raw_fec, datetime) else raw_fec
        elif isinstance(raw_fec, str):
            try:
                fecha_real = date.fromisoformat(raw_fec.strip().split("T")[0])
            except Exception:
                fecha_real = date.today()

        # Calcular fecha primera cuota según política mensual (último día del mes consecutivo a la fecha del crédito)
        total_meses = (fecha_real.year * 12 + fecha_real.month - 1) + 1
        nuevo_anio = total_meses // 12
        nuevo_mes = (total_meses % 12) + 1
        ultimo_dia = calendar.monthrange(nuevo_anio, nuevo_mes)[1]
        fecha_primera_cuota = date(nuevo_anio, nuevo_mes, ultimo_dia)

        # 5. Determinar estado inicial
        if saldo_insoluto <= Decimal("0.00"):
            estado_cred = EstadoCredito.TERMINADO
        else:
            estado_cred = EstadoCredito.ACTIVO

        # 6. Asignar cobrador si se indicó en la plantilla (Documento, Teléfono o Nombre - Opcional)
        raw_cob = str(ws_cred.cell(row=row_idx, column=col_cr_cob).value or "").strip()
        cobrador_id = None
        if raw_cob:
            cob_norm = raw_cob.lower()
            if raw_cob in cobradores_lookup:
                cobrador_id = cobradores_lookup[raw_cob]
            elif cob_norm in cobradores_lookup:
                cobrador_id = cobradores_lookup[cob_norm]
            else:
                for cob in cobradores_disponibles:
                    if cob.nombre and (cob_norm in cob.nombre.lower() or cob.nombre.lower() in cob_norm):
                        cobrador_id = cob.id
                        break

        # 7. Asignar producto de detalle
        raw_sku = str(ws_cred.cell(row=row_idx, column=col_cr_sku).value or "").strip().upper()
        prod_target = productos_creados_map.get(raw_sku)
        if not prod_target and raw_sku:
            res_p = await db.execute(select(Producto).where(Producto.sku == raw_sku))
            prod_target = res_p.scalar_one_or_none()

        if not prod_target:
            prod_target = prod_mig_hist

        # Extraer Numero_Contrato, Departamento_Venta y Municipio_Venta / Ciudad_Venta
        numero_contrato_val = None
        if col_cr_num:
            raw_num = ws_cred.cell(row=row_idx, column=col_cr_num).value
            if raw_num is not None and str(raw_num).strip():
                numero_contrato_val = str(raw_num).strip()

        departamento_venta_val = None
        if col_cr_dep:
            raw_dep = ws_cred.cell(row=row_idx, column=col_cr_dep).value
            if raw_dep is not None and str(raw_dep).strip():
                dep_norm = str(raw_dep).strip()
                if "sucre" in dep_norm.lower():
                    departamento_venta_val = "Sucre"
                elif "cordoba" in dep_norm.lower() or "córdoba" in dep_norm.lower():
                    departamento_venta_val = "Córdoba"
                else:
                    departamento_venta_val = dep_norm.title()

        ciudad_venta_val = None
        if col_cr_ciu:
            raw_ciu = ws_cred.cell(row=row_idx, column=col_cr_ciu).value
            if raw_ciu is not None and str(raw_ciu).strip():
                ciu_norm = str(raw_ciu).strip()
                ciudad_venta_val = ciu_norm.title()

        if not ciudad_venta_val:
            ciudad_venta_val = getattr(cliente_obj, "ciudad", None) or "Montería"

        if not departamento_venta_val:
            sucre_munis = {
                "sincelejo", "buenavista", "caimito", "colosó", "coloso", "corozal",
                "coveñas", "covenas", "chalán", "chalan", "el roble", "galeras",
                "guaranda", "la unión", "la union", "los palmitos", "majagual",
                "morroa", "ovejas", "palmito", "sampués", "sampues", "san benito abad",
                "san juan de betulia", "san marcos", "san onofre", "san pedro",
                "sincé", "since", "sucre", "tolú", "tolu", "toluviejo"
            }
            if ciudad_venta_val.lower() in sucre_munis:
                departamento_venta_val = "Sucre"
            else:
                departamento_venta_val = "Córdoba"

        # Validar unicidad si se provee numero_contrato
        if numero_contrato_val:
            if numero_contrato_val.upper() in contratos_procesados_set:
                errores.append({
                    "hoja": "Creditos_Historicos",
                    "fila": row_idx,
                    "motivo": f"El número de contrato '{numero_contrato_val}' está duplicado en este archivo Excel.",
                })
                resumen["creditos_omitidos"] += 1
                continue

            res_dup = await db.execute(
                select(Credito.id_contrato).where(Credito.numero_contrato.ilike(numero_contrato_val))
            )
            if res_dup.scalar_one_or_none():
                errores.append({
                    "hoja": "Creditos_Historicos",
                    "fila": row_idx,
                    "motivo": f"El número de contrato '{numero_contrato_val}' ya existe registrado en la base de datos.",
                })
                resumen["creditos_omitidos"] += 1
                continue

            contratos_procesados_set.add(numero_contrato_val.upper())

        # 8. Crear contrato de crédito histórico con fechas reales, número de contrato, departamento y ciudad
        dt_creacion = datetime.combine(fecha_real, datetime.min.time())
        nuevo_credito = Credito(
            cliente_id=cliente_obj.id,
            vendedor_id=current_user.id,
            supervisor_id=current_user.id if current_user.rol in (RolUsuario.SUPERVISOR, RolUsuario.MASTER) else None,
            cobrador_id=cobrador_id,
            numero_contrato=numero_contrato_val,
            departamento_venta=departamento_venta_val,
            ciudad_venta=ciudad_venta_val,
            estado=estado_cred,
            tipo_pago=TipoPago.MENSUAL,
            cuota_inicial=Decimal("0.00"),
            monto_financiado=valor_total,
            numero_cuotas=plazo_int,
            valor_cuota=valor_cuota,
            fecha_primera_cuota=fecha_primera_cuota,
            saldo_pendiente=saldo_insoluto,
            creado_en=dt_creacion,
        )
        db.add(nuevo_credito)
        await db.flush()

        # Asociar línea de detalle
        nuevo_detalle = CreditoDetalle(
            credito_id=nuevo_credito.id_contrato,
            producto_id=prod_target.id,
            cantidad=1,
            valor_unitario_acordado=valor_total,
        )
        db.add(nuevo_detalle)
        resumen["creditos_creados"] += 1

    await db.commit()

    return {
        "success": True,
        "mensaje": "Proceso de migración masiva finalizado exitosamente.",
        "resumen": resumen,
        "errores": errores,
        "total_advertencias": len(errores),
    }
