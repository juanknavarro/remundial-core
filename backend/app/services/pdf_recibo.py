import base64
import io
import os
import re
import unicodedata
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.graphics.shapes import Drawing, Rect

import copy
import json

from app.models.credito import Credito, TipoPago
from app.schemas.credito import generar_cronograma_con_arrastre

# Directorio local seguro para archivo inmutable de firmas digitales
FIRMAS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "storage", "firmas"))
os.makedirs(FIRMAS_DIR, exist_ok=True)

# Directorio local para archivo de actas de restitución
ACTAS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "storage", "actas"))
os.makedirs(ACTAS_DIR, exist_ok=True)

# Ruta al archivo de configuración centralizada
CONFIG_FILE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "storage", "config_parametros.json"))

DEFAULT_CONFIG_PDF = {
    "membrete": {
        "razon_social": "REMUNDIAL ARTE'S",
        "subtitulo": "Mueblería, Artesanías, Mecedoras & Cuadros por Encargo",
        "nit": "901.458.321-0",
        "regimen": "Régimen Comercial Colombiano",
        "ciudad": "Montería - Córdoba",
        "direccion": "Carrera 5 # 31-20, Centro",
        "telefono_pbx": "(+57) 300 123 4567",
        "correo": "info@remundialartes.com",
    },
    "clausulas_venta": (
        "<b>CLÁUSULAS GENERALES DE COMPRAVENTA Y FINANCIACIÓN:</b><br/>"
        "<b>1. Objeto y Recepción:</b> El CLIENTE adquiere a entera satisfacción los artículos y muebles descritos en este comprobante. "
        "<b>2. Cuadros al Óleo y Por Encargo:</b> Las obras artísticas por encargo se elaboran a mano con especificaciones acordadas; "
        "una vez iniciada la producción artística no se admiten cancelaciones ni retractos unilaterales. "
        "<b>3. Plan de Pagos Mensual:</b> Las cuotas pactadas vencen puntualmente el último día calendario de cada mes respectivo. "
        "Los abonos parciales reducen el saldo, y cualquier diferencia insoluta se arrastra a la siguiente exigibilidad sin alterar el plazo. "
        "<b>4. Reserva de Dominio y Mérito Ejecutivo:</b> Remundial Arte's conserva la propiedad de los bienes hasta el pago total de la obligación. "
        "El presente documento presta mérito ejecutivo de conformidad con la legislación mercantil colombiana."
    ),
    "certificacion_recaudo": (
        "<b>CERTIFICACIÓN DE PAGO:</b> Este recibo digital certifica formalmente la recepción y registro del recaudo "
        "en las cuentas de Remundial Arte's. La presente constancia amortiza el saldo del contrato especificado y queda "
        "asentada de manera inmutable en los libros auxiliares de cartera. Conserve este comprobante para cualquier conciliación contable."
    ),
    "acta_restitucion": {
        "clausula_legal": (
            "<b>CLÁUSULA DE ENTREGA Y RESTITUCIÓN VOLUNTARIA DE BIENES:</b> En la fecha y hora señaladas en el encabezado, "
            "el CLIENTE / DEUDOR TITULAR hace entrega material, formal y pacífica a REMUNDIAL ARTE'S de los artículos descritos "
            "en el inventario anterior, en aplicación estricta de las estipulaciones contractuales sobre reserva de dominio y "
            "garantía mobiliaria pactadas en el contrato original de venta a crédito, motivado por la mora grave de tres (3) o más "
            "cuotas vencidas. REMUNDIAL ARTE'S recibe los bienes en calidad de custodia y para los trámites legales de avalúo, "
            "liquidación y compensación del saldo deudor remanente. Ambas partes declaran haber verificado el estado físico de los "
            "bienes retirados y estampan su consentimiento formal mediante firma digitalizada."
        ),
        "observaciones_defecto": "Departamento de Cartera y Recuperación de Bienes",
        "pie_pagina": "Diligencia ejecutada conforme al régimen de garantías mobiliarias y reserva de dominio contractual.",
    },
}


def formatear_texto_reportlab(texto: Optional[str]) -> str:
    """Asegura que el texto para párrafos ReportLab conserve saltos de línea sin romper formato XML."""
    if not texto:
        return ""
    texto_str = str(texto).strip()
    if "\n" in texto_str and "<br" not in texto_str:
        return texto_str.replace("\r\n", "<br/>").replace("\n", "<br/>")
    return texto_str


def obtener_configuracion_pdf() -> dict:
    """Carga la configuración de membrete, cláusulas y certificaciones legales en tiempo real."""
    cfg = copy.deepcopy(DEFAULT_CONFIG_PDF)
    if os.path.exists(CONFIG_FILE_PATH):
        try:
            with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)

                # Priorizar datos de empresa básicos si no hay membrete explícito
                if "empresa" in saved and isinstance(saved["empresa"], dict):
                    emp = saved["empresa"]
                    if emp.get("razon_social"):
                        cfg["membrete"]["razon_social"] = emp["razon_social"].strip().upper()
                    if "nit" in emp and emp["nit"] is not None:
                        cfg["membrete"]["nit"] = emp["nit"].strip()
                    if emp.get("ciudad_principal"):
                        cfg["membrete"]["ciudad"] = emp["ciudad_principal"].strip()
                    if emp.get("telefono_soporte"):
                        cfg["membrete"]["telefono_pbx"] = emp["telefono_soporte"].strip()

                if "plantillas_pdf" in saved and isinstance(saved["plantillas_pdf"], dict):
                    p_pdf = saved["plantillas_pdf"]
                    if "membrete" in p_pdf and isinstance(p_pdf["membrete"], dict):
                        for k, v in p_pdf["membrete"].items():
                            if v is not None:
                                cfg["membrete"][k] = str(v).strip()
                    if "clausulas_venta" in p_pdf and p_pdf["clausulas_venta"] is not None:
                        cfg["clausulas_venta"] = p_pdf["clausulas_venta"]
                    if "certificacion_recaudo" in p_pdf and p_pdf["certificacion_recaudo"] is not None:
                        cfg["certificacion_recaudo"] = p_pdf["certificacion_recaudo"]
                    if "acta_restitucion" in p_pdf and isinstance(p_pdf["acta_restitucion"], dict):
                        for k, v in p_pdf["acta_restitucion"].items():
                            if v is not None:
                                cfg["acta_restitucion"][k] = str(v).strip()
        except Exception as e:
            print(f"[PDF] Error cargando configuración personalizada: {e}")
    return cfg


def construir_lineas_membrete_sub(membrete: dict, tipo_contacto: str = "Ventas") -> str:
    """Construye las líneas de subtítulo institucional (NIT, Ciudad, Dirección, PBX, Correo)."""
    sub_lines = []
    if membrete.get("subtitulo") and str(membrete["subtitulo"]).strip():
        sub_lines.append(f"<b>{str(membrete['subtitulo']).strip()}</b>")

    nit_reg = []
    if membrete.get("nit") and str(membrete["nit"]).strip():
        nit_reg.append(f"NIT: {str(membrete['nit']).strip()}")
    if membrete.get("regimen") and str(membrete["regimen"]).strip():
        nit_reg.append(str(membrete["regimen"]).strip())
    if nit_reg:
        sub_lines.append(" • ".join(nit_reg))

    ciu_dir = []
    if membrete.get("ciudad") and str(membrete["ciudad"]).strip():
        ciu_dir.append(str(membrete["ciudad"]).strip())
    if membrete.get("direccion") and str(membrete["direccion"]).strip():
        ciu_dir.append(str(membrete["direccion"]).strip())
    if ciu_dir:
        sub_lines.append(" • ".join(ciu_dir))

    tel_cor = []
    if membrete.get("telefono_pbx") and str(membrete["telefono_pbx"]).strip():
        tel_cor.append(f"PBX / {tipo_contacto}: {str(membrete['telefono_pbx']).strip()}")
    if membrete.get("correo") and str(membrete["correo"]).strip():
        tel_cor.append(str(membrete["correo"]).strip())
    if tel_cor:
        sub_lines.append(" • ".join(tel_cor))

    return "<br/>".join(sub_lines)


def guardar_firmas_acta(
    id_contrato: Any,
    firma_cliente: Optional[str] = None,
    firma_cobrador: Optional[str] = None,
) -> None:
    """Almacena las firmas del acta de restitución en formato PNG Base64 en disco."""
    if not id_contrato:
        return
    cid = str(id_contrato).strip().lower()
    firmas = {
        "acta_cliente": firma_cliente,
        "acta_cobrador": firma_cobrador,
    }
    for tipo, b64 in firmas.items():
        if b64 and len(b64) > 30:
            try:
                path = os.path.join(FIRMAS_DIR, f"{cid}_{tipo}.png")
                raw_data = b64.split(",")[-1].strip()
                with open(path, "wb") as f:
                    f.write(base64.b64decode(raw_data))
            except Exception as e:
                print(f"[PDF] Error guardando firma de acta {tipo} para {cid}:", e)



def sanitizar_nombre_archivo(texto: str) -> str:
    """Normaliza y sanitiza cadenas para nombres de archivo legibles y seguros (sin tildes ni símbolos)."""
    if not texto:
        return "Cliente"
    normalizado = unicodedata.normalize("NFKD", str(texto)).encode("ASCII", "ignore").decode("utf-8")
    limpio = re.sub(r"[^\w\s-]", "", normalizado).strip()
    limpio = re.sub(r"[-\s]+", "_", limpio)
    return limpio or "Cliente"


def construir_nombre_archivo_pdf(
    tipo: str,
    id_contrato: Any,
    nombre_cliente: str,
    fecha: Optional[Any] = None,
    cuota: Optional[Any] = None,
) -> str:
    """Construye estrictamente el nombre de archivo con nomenclatura humana:
    [Tipo]_[ID_Contrato]_[Cuota]_[Nombre_Cliente]_[YYYY-MM-DD].pdf
    """
    if fecha is None:
        f_dt = date.today()
    elif isinstance(fecha, str):
        try:
            f_dt = date.fromisoformat(fecha.split("T")[0])
        except Exception:
            f_dt = date.today()
    elif isinstance(fecha, datetime):
        f_dt = fecha.date()
    elif isinstance(fecha, date):
        f_dt = fecha
    else:
        f_dt = date.today()

    f_str = f_dt.strftime("%Y-%m-%d")
    nom_clean = sanitizar_nombre_archivo(nombre_cliente)
    ctr_str = str(id_contrato or "CTR-GRAL").strip().upper()
    if not ctr_str.startswith("CTR-") and len(ctr_str) >= 8:
        ctr_str = f"CTR-{ctr_str[:8]}"
    elif not ctr_str.startswith("CTR-"):
        ctr_str = f"CTR-{ctr_str}"

    tipo_clean = str(tipo).strip()
    if cuota is not None and str(cuota).strip():
        c_raw = str(cuota).strip()
        cuota_str = f"Cuota-{c_raw}" if c_raw.isdigit() else c_raw
        return f"{tipo_clean}_{ctr_str}_{cuota_str}_{nom_clean}_{f_str}.pdf"
    return f"{tipo_clean}_{ctr_str}_{nom_clean}_{f_str}.pdf"


def guardar_firmas_contrato(
    id_contrato: Any,
    firma_titular: Optional[str] = None,
    firma_vendedor: Optional[str] = None,
    firma_codeudor: Optional[str] = None,
    firma_supervisor: Optional[str] = None,
    firma_cajero: Optional[str] = None,
    firma_cliente: Optional[str] = None,
) -> None:
    """Almacena las firmas en formato base64 PNG en el sistema de archivos local para trazabilidad inmutable."""
    if not id_contrato:
        return
    cid = str(id_contrato).strip().lower()
    titular_final = firma_cliente or firma_titular
    supervisor_final = firma_supervisor or firma_vendedor or firma_cajero
    firmas = {
        "titular": titular_final,
        "cliente": titular_final,
        "vendedor": supervisor_final,
        "supervisor": supervisor_final,
        "codeudor": firma_codeudor,
        "cajero": firma_cajero,
    }
    for tipo, b64 in firmas.items():
        if b64 and len(b64) > 30:
            try:
                path = os.path.join(FIRMAS_DIR, f"{cid}_{tipo}.png")
                raw_data = b64.split(",")[-1].strip()
                with open(path, "wb") as f:
                    f.write(base64.b64decode(raw_data))
            except Exception as e:
                print(f"[PDF] Error guardando firma {tipo} para {cid}:", e)


def guardar_firma_abono(
    id_recibo: Any,
    firma_cliente: Optional[str] = None,
    firma_cobrador: Optional[str] = None,
) -> None:
    """Almacena las firmas de un recibo de abono en formato PNG Base64 en el almacenamiento local."""
    if not id_recibo:
        return
    rid = str(id_recibo).strip().lower()
    firmas = {
        "cliente": firma_cliente,
        "cobrador": firma_cobrador,
    }
    for tipo, b64 in firmas.items():
        if b64 and len(b64) > 30:
            try:
                path = os.path.join(FIRMAS_DIR, f"{rid}_{tipo}.png")
                raw_data = b64.split(",")[-1].strip()
                with open(path, "wb") as f:
                    f.write(base64.b64decode(raw_data))
            except Exception as e:
                print(f"[PDF] Error guardando firma de abono {tipo} para {rid}:", e)


def obtener_firma_almacenada(id_contrato: Any, tipo: str) -> Optional[str]:
    """Obtiene la firma de un contrato almacenada en disco si existe."""
    if not id_contrato:
        return None
    cid = str(id_contrato).strip().lower()
    path = os.path.join(FIRMAS_DIR, f"{cid}_{tipo}.png")
    if os.path.exists(path):
        try:
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode("ascii")
        except Exception:
            return None
    return None


def crear_bloque_firma_imagen(img_b64: Optional[str], fallback_height: float = 24) -> Any:
    """Genera un Flowable Image para estampar la firma manuscrita sobre la línea en el PDF con proporción visual natural."""
    if img_b64 and isinstance(img_b64, str):
        try:
            raw_b64 = img_b64.split(",")[-1].strip()
            img_data = base64.b64decode(raw_b64)
            if len(img_data) > 40:
                try:
                    from PIL import Image as PILImage
                    with PILImage.open(io.BytesIO(img_data)) as pil_img:
                        orig_w, orig_h = pil_img.size
                        if orig_w > 0 and orig_h > 0:
                            ratio = orig_w / orig_h
                            target_h = 36.0
                            target_w = target_h * ratio
                            if target_w > 150.0:
                                target_w = 150.0
                                target_h = target_w / ratio
                            return Image(io.BytesIO(img_data), width=target_w, height=target_h)
                except Exception:
                    pass
                return Image(io.BytesIO(img_data), width=120, height=36)
        except Exception as e:
            print("[PDF] Error procesando imagen de firma:", e)
    return Spacer(1, fallback_height)


def format_cop(valor: Any) -> str:
    """Formatea un número o Decimal a formato moneda COP estándar: $ 1.250.000."""
    try:
        num = float(valor or 0)
        formatted = f"{num:,.0f}".replace(",", ".")
        return f"$ {formatted}"
    except (ValueError, TypeError):
        return "$ 0"


def obtener_timestamp_local_servidor(dt: Optional[Any] = None) -> datetime:
    """Retorna el timestamp local real del servidor al momento de la orden/abono,
    evitando desfases de zona horaria y asegurando horas, minutos y segundos reales (YYYY-MM-DD HH:mm:ss)."""
    now_local = datetime.now()
    if dt is None:
        return now_local

    if isinstance(dt, str):
        clean_str = dt.strip()
        try:
            parsed_dt = datetime.fromisoformat(clean_str.replace("Z", "+00:00"))
            if parsed_dt.hour == 0 and parsed_dt.minute == 0 and parsed_dt.second == 0:
                return datetime.combine(parsed_dt.date(), now_local.time())
            return parsed_dt.astimezone() if parsed_dt.tzinfo else parsed_dt
        except Exception:
            try:
                parsed_dt = datetime.strptime(clean_str[:19], "%Y-%m-%d %H:%M:%S")
                if parsed_dt.hour == 0 and parsed_dt.minute == 0 and parsed_dt.second == 0:
                    return datetime.combine(parsed_dt.date(), now_local.time())
                return parsed_dt
            except Exception:
                try:
                    date_part = datetime.strptime(clean_str[:10], "%Y-%m-%d").date()
                    return datetime.combine(date_part, now_local.time())
                except Exception:
                    return now_local

    if isinstance(dt, date) and not isinstance(dt, datetime):
        return datetime.combine(dt, now_local.time())

    if isinstance(dt, datetime):
        if dt.hour == 0 and dt.minute == 0 and dt.second == 0:
            return datetime.combine(dt.date(), now_local.time())
        try:
            if dt.tzinfo is not None:
                return dt.astimezone()
            return dt
        except Exception:
            return dt

    return now_local


class ReciboNumberedCanvas(canvas.Canvas):
    """Canvas de dos pasos para calcular el total exacto de páginas y estampar pie de página corporativo."""

    fecha_impresion: str = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count: int):
        self.saveState()
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#64748B"))  # Slate-500

        # Línea divisoria de pie de página
        self.setStrokeColor(colors.HexColor("#E2E8F0"))  # Slate-200
        self.setLineWidth(0.5)
        self.line(32, 28, 580, 28)

        # Textos de pie de página con timestamp local real idéntico al encabezado
        fecha_str = self.fecha_impresion or obtener_timestamp_local_servidor().strftime("%Y-%m-%d %H:%M:%S")
        footer_left = (
            f"Remundial Arte's • Comprobante Digital y Contrato de Venta • Montería, Córdoba • Generado: {fecha_str}"
        )
        footer_right = f"Página {self._pageNumber} de {page_count}"

        self.drawString(32, 18, footer_left)
        self.drawRightString(580, 18, footer_right)

        self.restoreState()


def generar_pdf_recibo_venta(credito: Credito) -> bytes:
    """Genera un comprobante oficial de venta y contrato en PDF para un crédito o venta de contado.
    
    Inspirado en la estructura del talonario físico de "Remundial Arte's" (Montería - Córdoba):
    - Encabezado corporativo oficial con datos comerciales de la empresa.
    - Metadatos de la operación (N° de Contrato CTR-XXXX, Fecha, Asesor Comercial, Modalidad).
    - Datos del cliente titular y codeudor solidario / referencia.
    - Detalle de artículos comprados, diferenciando piezas en Stock de Cuadros por Encargo.
    - Resumen financiero claro (Total Venta, Anticipo / Inicial, Saldo Financiado, Valor Cuota).
    - Plan de Pagos mensual programado a fin de mes.
    - Cláusulas contractuales resumidas.
    - Bloque de firmas con espacio para aceptación y huella dactilar.
    """
    buffer = io.BytesIO()

    # Documento en tamaño Carta (Portrait), márgenes compactos de 32 puntos
    # Ancho total: 612 pt. Ancho útil: 612 - 64 = 548 pt.
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=32,
        rightMargin=32,
        topMargin=28,
        bottomMargin=36,
    )

    story = []
    base_styles = getSampleStyleSheet()
    cfg_pdf = obtener_configuracion_pdf()
    m_cfg = cfg_pdf["membrete"]

    # Paleta de Colores
    c_primary = colors.HexColor("#0F172A")    # Slate-900 (Azul oscuro / Carbón)
    c_emerald = colors.HexColor("#059669")    # Emerald-600
    c_emerald_bg = colors.HexColor("#ECFDF5") # Emerald-50
    c_amber = colors.HexColor("#B45309")      # Amber-700
    c_amber_bg = colors.HexColor("#FFFBEB")   # Amber-50
    c_slate_bg = colors.HexColor("#F8FAFC")   # Slate-50
    c_border = colors.HexColor("#E2E8F0")     # Slate-200
    c_text = colors.HexColor("#1E293B")       # Slate-800
    c_muted = colors.HexColor("#64748B")      # Slate-500

    # Tipografías y Estilos de Párrafo
    style_title = ParagraphStyle(
        "ReciboTitle",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=16,
        textColor=c_primary,
    )
    style_company_sub = ParagraphStyle(
        "ReciboCompanySub",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10,
        textColor=c_muted,
    )
    style_voucher_title = ParagraphStyle(
        "ReciboVoucherTitle",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=c_primary,
        alignment=2,  # Derecha
    )
    style_voucher_ctr = ParagraphStyle(
        "ReciboVoucherCTR",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=14,
        textColor=c_emerald,
        alignment=2,  # Derecha
    )
    style_voucher_meta = ParagraphStyle(
        "ReciboVoucherMeta",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10,
        textColor=c_text,
        alignment=2,  # Derecha
    )
    style_section_heading = ParagraphStyle(
        "ReciboSectionHeading",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=10,
        textColor=c_primary,
    )
    style_card_label = ParagraphStyle(
        "ReciboCardLabel",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=9,
        textColor=c_muted,
    )
    style_card_value = ParagraphStyle(
        "ReciboCardValue",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        textColor=c_text,
    )
    style_table_header = ParagraphStyle(
        "ReciboTableHeader",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9,
        textColor=colors.white,
    )
    style_table_cell = ParagraphStyle(
        "ReciboTableCell",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        textColor=c_text,
    )
    style_table_cell_bold = ParagraphStyle(
        "ReciboTableCellBold",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        textColor=c_text,
    )
    style_badge_encargo = ParagraphStyle(
        "ReciboBadgeEncargo",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8.5,
        textColor=c_amber,
    )
    style_badge_stock = ParagraphStyle(
        "ReciboBadgeStock",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=8.5,
        textColor=c_muted,
    )
    style_clause = ParagraphStyle(
        "ReciboClause",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=6.5,
        leading=8.5,
        textColor=colors.HexColor("#475569"),
    )
    style_signature_label = ParagraphStyle(
        "ReciboSigLabel",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        textColor=c_primary,
        alignment=1,  # Centro
    )
    style_signature_sub = ParagraphStyle(
        "ReciboSigSub",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=8.5,
        textColor=c_muted,
        alignment=1,  # Centro
    )

    # 1. EXTRACCIÓN Y FORMATEO DE METADATOS CON TIMESTAMP LOCAL REAL
    num_manual = getattr(credito, "numero_contrato", None)
    codigo_ctr = (
        num_manual.strip()
        if (num_manual and num_manual.strip())
        else f"CTR-{str(credito.id_contrato)[:8].upper()}"
    )
    dt_orden = getattr(credito, "creado_en", None) or datetime.now()
    dt_local = obtener_timestamp_local_servidor(dt_orden)
    fecha_emision = dt_local.strftime("%d/%m/%Y %I:%M %p")
    ReciboNumberedCanvas.fecha_impresion = fecha_emision
    asesor_nombre = credito.vendedor.nombre if credito.vendedor else "Asesor de Ventas"
    es_contado = (
        credito.monto_financiado == Decimal("0.00")
        or credito.numero_cuotas == 1
        and credito.cuota_inicial >= credito.monto_financiado
    )
    modalidad_str = "VENTA DE CONTADO" if es_contado else f"CRÉDITO MENSUAL ({credito.numero_cuotas} CUOTAS A FIN DE MES)"
    
    # Evaluación del estado de aprobación de la venta
    raw_estado = (credito.estado.value if hasattr(credito.estado, "value") else str(credito.estado)).lower()
    abonos_list = getattr(credito, "abonos", []) or []
    total_abonado = sum((Decimal(str(getattr(a, "valor_abonado", 0) or 0)) for a in abonos_list), Decimal("0.00"))

    es_rechazado = (
        raw_estado == "terminado"
        and credito.monto_financiado > Decimal("0.00")
        and total_abonado == Decimal("0.00")
        and (credito.saldo_pendiente == Decimal("0.00") or getattr(credito, "supervisor_id", None) is not None)
    )
    es_pendiente = raw_estado == "pendiente"
    es_activo = raw_estado == "activo"

    if es_rechazado:
        estado_label = "RECHAZADO / INHABILITADO"
        estado_color = "#DC2626"
    elif es_pendiente:
        estado_label = "PENDIENTE / EN ESPERA"
        estado_color = "#D97706"
    elif es_activo:
        estado_label = "APROBADO / ACTIVO"
        estado_color = "#059669"
    elif raw_estado == "mora":
        estado_label = "EN MORA"
        estado_color = "#EA580C"
    else:
        estado_label = "FINALIZADO / CONTADO" if es_contado else "FINALIZADO (PAGADO)"
        estado_color = "#0284C7"

    # 2. ENCABEZADO OFICIAL PERSONALIZADO
    # Columna Izquierda: Logo y Razón Social • Columna Derecha: Recuadro Oficial de Comprobante
    header_col_izq = [
        Paragraph(m_cfg.get("razon_social") or "REMUNDIAL ARTE'S", style_title),
        Spacer(1, 2),
        Paragraph(
            construir_lineas_membrete_sub(m_cfg, tipo_contacto="Ventas"),
            style_company_sub,
        ),
    ]

    header_col_der = [
        Paragraph("RECIBO OFICIAL DE VENTA & CONTRATO", style_voucher_title),
        Paragraph(codigo_ctr, style_voucher_ctr),
        Spacer(1, 2),
        Paragraph(
            f"<b>Fecha:</b> {fecha_emision}<br/>"
            f"<b>Asesor:</b> {asesor_nombre}<br/>"
            f"<b>Modalidad:</b> {modalidad_str}<br/>"
            f"<b>Estado:</b> <font color='{estado_color}'><b>{estado_label}</b></font>",
            style_voucher_meta,
        ),
    ]

    header_table = Table(
        [[header_col_izq, header_col_der]],
        colWidths=[310, 238],
    )
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=1, color=c_primary, spaceBefore=4, spaceAfter=8))

    # 3. DATOS DEL CLIENTE (TITULAR) Y CODEUDOR SOLIDARIO / GARANTÍAS
    cliente = credito.cliente
    cliente_nombre = cliente.nombres if cliente else "Cliente General"
    cliente_cedula = cliente.cedula if cliente else "S/N"
    cliente_tel = cliente.telefono or "No registrado" if cliente else "No registrado"
    cliente_dir = cliente.direccion if cliente else "Montería, Córdoba"
    cliente_barrio = cliente.barrio or "Centro" if cliente else "Centro"
    cliente_ciudad = cliente.ciudad or "Montería" if cliente else "Montería"

    codeudor_info = getattr(credito, "codeudor", None)
    if not codeudor_info and cliente and getattr(cliente, "codeudor", None):
        codeudor_info = cliente.codeudor

    referencia_info = getattr(credito, "referencia", None)
    if not referencia_info and cliente and getattr(cliente, "referencia_familiar", None):
        referencia_info = cliente.referencia_familiar

    # Panel Cliente Titular
    cliente_block = [
        Paragraph("DATOS DEL CLIENTE (TITULAR)", style_section_heading),
        Spacer(1, 3),
        Paragraph(
            f"<b>Nombre Completo:</b> {cliente_nombre}<br/>"
            f"<b>Cédula / Documento:</b> {cliente_cedula}<br/>"
            f"<b>Teléfono de Contacto:</b> {cliente_tel}<br/>"
            f"<b>Dirección Domicilio:</b> {cliente_dir}<br/>"
            f"<b>Barrio / Municipio:</b> {cliente_barrio}, {cliente_ciudad}",
            style_card_value,
        ),
    ]

    # Panel Codeudor Solidario / Referencia de Respaldo
    if codeudor_info and codeudor_info.get("nombre"):
        cod_nom = codeudor_info.get("nombre", "No especificado")
        cod_cc = codeudor_info.get("cedula") or "No registrada"
        cod_tel = codeudor_info.get("telefono") or "No registrado"
        cod_dir = codeudor_info.get("direccion") or "No registrada"
        codeudor_block = [
            Paragraph("CODEUDOR SOLIDARIO (GARANTE)", style_section_heading),
            Spacer(1, 3),
            Paragraph(
                f"<b>Nombre:</b> {cod_nom}<br/>"
                f"<b>Cédula:</b> {cod_cc}<br/>"
                f"<b>Teléfono:</b> {cod_tel}<br/>"
                f"<b>Dirección:</b> {cod_dir}<br/>"
                f"<b>Calidad:</b> Codeudor Solidario y Mancomunado",
                style_card_value,
            ),
        ]
    elif referencia_info and referencia_info.get("nombre"):
        ref_nom = referencia_info.get("nombre", "No especificado")
        ref_par = referencia_info.get("parentesco", "Familiar")
        ref_tel = referencia_info.get("telefono") or "No registrado"
        codeudor_block = [
            Paragraph("GARANTÍA / REFERENCIA DE RESPALDO", style_section_heading),
            Spacer(1, 3),
            Paragraph(
                f"<b>Contacto de Respaldo:</b> {ref_nom}<br/>"
                f"<b>Parentesco:</b> {ref_par}<br/>"
                f"<b>Teléfono:</b> {ref_tel}<br/>"
                f"<b>Garantía:</b> Verificación telefónica y domiciliaria aprobada",
                style_card_value,
            ),
        ]
    else:
        codeudor_block = [
            Paragraph("GARANTÍAS Y RESPALDO", style_section_heading),
            Spacer(1, 3),
            Paragraph(
                "<b>Garantía:</b> Titular Directo sin codeudor solidario.<br/>"
                "Aprobado bajo score de confianza comercial y validación directa.<br/>"
                "Garantía prendaria sobre los bienes muebles objeto del contrato.",
                style_card_value,
            ),
        ]

    partes_table = Table(
        [[cliente_block, codeudor_block]],
        colWidths=[270, 278],
    )
    partes_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (0, 0), c_slate_bg),
                ("BACKGROUND", (1, 0), (1, 0), c_slate_bg),
                ("BOX", (0, 0), (0, 0), 0.5, c_border),
                ("BOX", (1, 0), (1, 0), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(partes_table)
    story.append(Spacer(1, 8))

    # 4. DETALLE DE ARTÍCULOS COMPRADOS (DIFERENCIANDO NORMALES DE CUADROS POR ENCARGO)
    articulos_heading = Table(
        [[Paragraph("DETALLE DE ARTÍCULOS Y BIENES ADQUIRIDOS", style_section_heading)]],
        colWidths=[548],
    )
    articulos_heading.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(articulos_heading)
    story.append(Spacer(1, 3))

    detalles = getattr(credito, "detalles", []) or []
    items_rows = [
        [
            Paragraph("<b>#</b>", style_table_header),
            Paragraph("<b>Descripción del Artículo</b>", style_table_header),
            Paragraph("<b>Tipo / Categoría</b>", style_table_header),
            Paragraph("<b>Cant.</b>", style_table_header),
            Paragraph("<b>Precio Unit.</b>", style_table_header),
            Paragraph("<b>Subtotal</b>", style_table_header),
        ]
    ]

    total_calculado_articulos = Decimal("0.00")
    if detalles:
        for idx, det in enumerate(detalles, start=1):
            prod = det.producto
            prod_nombre = prod.nombre if prod else "Artículo Comercial"
            prod_sku = prod.sku if prod else ""

            # Distinción estricta de Cuadro por Encargo vs Stock
            es_cuadro_encargo = False
            if prod:
                if not getattr(prod, "maneja_stock", True):
                    es_cuadro_encargo = True
                elif "cuadro" in prod.nombre.lower() or "encargo" in prod.nombre.lower():
                    es_cuadro_encargo = True
                elif getattr(prod, "es_precio_variable", False):
                    es_cuadro_encargo = True

            if es_cuadro_encargo:
                tipo_badge = Paragraph("🎨 <b>Cuadro por Encargo</b><br/><font size='5.5' color='#B45309'>Hecho a mano / Sobre Pedido</font>", style_badge_encargo)
            else:
                tipo_badge = Paragraph("📦 Línea Estándar<br/><font size='5.5' color='#64748B'>Mueble / Stock Almacén</font>", style_badge_stock)

            cant = det.cantidad or 1
            v_unit = Decimal(str(det.valor_unitario_acordado or 0))
            subt = det.subtotal if det.subtotal is not None else (Decimal(cant) * v_unit)
            total_calculado_articulos += Decimal(str(subt))

            desc_p = Paragraph(
                f"<b>{prod_nombre}</b>" + (f"<br/><font size='6' color='#64748B'>SKU: {prod_sku}</font>" if prod_sku else ""),
                style_table_cell,
            )

            items_rows.append(
                [
                    Paragraph(str(idx), style_table_cell),
                    desc_p,
                    tipo_badge,
                    Paragraph(str(cant), style_table_cell),
                    Paragraph(format_cop(v_unit), style_table_cell),
                    Paragraph(format_cop(subt), style_table_cell_bold),
                ]
            )
    else:
        items_rows.append(
            [
                Paragraph("1", style_table_cell),
                Paragraph("Venta de Bienes Muebles y Decoración Remundial", style_table_cell),
                Paragraph("Línea Estándar", style_badge_stock),
                Paragraph("1", style_table_cell),
                Paragraph(format_cop(credito.cuota_inicial + credito.monto_financiado), style_table_cell),
                Paragraph(format_cop(credito.cuota_inicial + credito.monto_financiado), style_table_cell_bold),
            ]
        )
        total_calculado_articulos = Decimal(str(credito.cuota_inicial + credito.monto_financiado))

    # Anchos de columna que suman exactamente 548 pt:
    # 25 + 205 + 130 + 38 + 75 + 75 = 548 pt
    items_table = Table(items_rows, colWidths=[25, 205, 130, 38, 75, 75])
    items_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), c_primary),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (3, 0), (3, -1), "CENTER"),
                ("ALIGN", (4, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(items_table)
    story.append(Spacer(1, 8))

    # 5. RESUMEN FINANCIERO Y PLAN DE PAGOS (A FIN DE MES)
    valor_total_venta = Decimal(str(credito.cuota_inicial or 0)) + Decimal(str(credito.monto_financiado or 0))
    if valor_total_venta <= Decimal("0.00") and total_calculado_articulos > Decimal("0.00"):
        valor_total_venta = total_calculado_articulos

    cuota_inicial_val = Decimal(str(credito.cuota_inicial or 0))
    monto_financiado_val = Decimal(str(credito.monto_financiado or 0))
    valor_cuota_val = Decimal(str(credito.valor_cuota or 0))

    # Tarjetas de resumen financiero (4 bloques)
    summary_card_1 = [
        Paragraph("VALOR TOTAL OPERACIÓN", style_card_label),
        Spacer(1, 2),
        Paragraph(f"<b>{format_cop(valor_total_venta)}</b>", style_title),
        Paragraph("<font size='6.5' color='#64748B'>Precio total acordado</font>", style_company_sub),
    ]

    color_inicial_bg = c_emerald_bg if cuota_inicial_val > Decimal("0.00") else c_slate_bg
    summary_card_2 = [
        Paragraph("CUOTA INICIAL (ANTICIPO)", style_card_label),
        Spacer(1, 2),
        Paragraph(f"<font color='#059669'><b>{format_cop(cuota_inicial_val)}</b></font>", style_title),
        Paragraph("<font size='6.5' color='#059669'>Recibido en caja</font>" if cuota_inicial_val > 0 else "<font size='6.5' color='#64748B'>Sin anticipo</font>", style_company_sub),
    ]

    summary_card_3 = [
        Paragraph("SALDO FINANCIADO", style_card_label),
        Spacer(1, 2),
        Paragraph(f"<b>{format_cop(monto_financiado_val)}</b>", style_title),
        Paragraph(f"<font size='6.5' color='#64748B'>{credito.numero_cuotas} cuotas periódicas</font>", style_company_sub),
    ]

    summary_card_4 = [
        Paragraph("VALOR CUOTA MENSUAL", style_card_label),
        Spacer(1, 2),
        Paragraph(f"<font color='#0F172A'><b>{format_cop(valor_cuota_val)}</b></font>", style_title),
        Paragraph("<font size='6.5' color='#64748B'>Vencimiento a fin de mes</font>", style_company_sub),
    ]

    cards_table = Table(
        [[summary_card_1, summary_card_2, summary_card_3, summary_card_4]],
        colWidths=[137, 137, 137, 137],
    )
    cards_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), c_slate_bg),
                ("BACKGROUND", (1, 0), (1, 0), color_inicial_bg),
                ("BACKGROUND", (2, 0), (2, 0), c_slate_bg),
                ("BACKGROUND", (3, 0), (3, 0), c_slate_bg),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(cards_table)
    story.append(Spacer(1, 8))

    # 6. PLAN DE PAGOS MENSUAL O INHABILITACIÓN POR RECHAZO
    if es_rechazado:
        rechazo_block = [
            Paragraph("<b>SOLICITUD RECHAZADA POR SUPERVISIÓN</b>", style_section_heading),
            Spacer(1, 4),
            Paragraph(
                "<font color='#DC2626'><b>EJECUCIÓN DE CARTERA INHABILITADA:</b></font> "
                "Esta solicitud de venta a crédito no fue aprobada en la revisión de supervisión. "
                "El contrato se encuentra inhabilitado permanentemente, no genera plan de amortización activo, "
                "no constituye título valor exigible y se encuentra formalmente excluido de las rutas de recaudo.",
                style_card_value,
            ),
        ]
        rechazo_table = Table([[rechazo_block]], colWidths=[548])
        rechazo_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FEF2F2")),
                    ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#FCA5A5")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(rechazo_table)
        story.append(Spacer(1, 8))
    elif not es_contado and monto_financiado_val > Decimal("0.00"):
        cron_titulo = (
            "PLAN DE PAGOS PROYECTADO (SUJETO A APROBACIÓN DE SUPERVISIÓN)"
            if es_pendiente
            else "PLAN DE PAGOS MENSUAL PROGRAMADO (VENCIMIENTOS A FIN DE MES)"
        )
        cronograma_res = generar_cronograma_con_arrastre(
            fecha_primera_cuota=credito.fecha_primera_cuota or date.today(),
            numero_cuotas=credito.numero_cuotas,
            monto_financiado=monto_financiado_val,
            saldo_pendiente=credito.saldo_pendiente,
            valor_cuota_base=valor_cuota_val,
            tipo_pago=credito.tipo_pago or TipoPago.MENSUAL,
        )
        cuotas_cron = cronograma_res.get("cronograma", [])

        cron_heading = Table(
            [[Paragraph(cron_titulo, style_section_heading)]],
            colWidths=[548],
        )
        cron_heading.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FEF3C7") if es_pendiente else colors.HexColor("#F1F5F9")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(cron_heading)
        story.append(Spacer(1, 3))

        cron_rows = [
            [
                Paragraph("<b>Cuota N°</b>", style_table_header),
                Paragraph("<b>Fecha Vencimiento (Fin de Mes)</b>", style_table_header),
                Paragraph("<b>Valor Base</b>", style_table_header),
                Paragraph("<b>Arrastre / Exigible</b>", style_table_header),
                Paragraph("<b>Estado</b>", style_table_header),
            ]
        ]

        for q in cuotas_cron:
            fecha_venc_str = q.fecha_vencimiento.strftime("%d/%m/%Y")
            st_text = "Pendiente"
            if q.pagada:
                st_text = "PAGADA"
            elif q.es_parcial:
                st_text = "ABONO PARCIAL"

            cron_rows.append(
                [
                    Paragraph(f"Cuota {q.numero} de {credito.numero_cuotas}", style_table_cell),
                    Paragraph(f"<b>{fecha_venc_str}</b> (Último día)", style_table_cell),
                    Paragraph(format_cop(q.valor_base), style_table_cell),
                    Paragraph(format_cop(q.valor_exigible), style_table_cell_bold),
                    Paragraph(st_text, style_table_cell),
                ]
            )

        # 548 pt = 85 + 185 + 95 + 105 + 78
        cron_table = Table(cron_rows, colWidths=[85, 185, 95, 105, 78])
        cron_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
                    ("ALIGN", (0, 0), (0, -1), "CENTER"),
                    ("ALIGN", (2, 0), (3, -1), "RIGHT"),
                    ("ALIGN", (4, 0), (4, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                    ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(cron_table)
        story.append(Spacer(1, 8))

    # 7. CLÁUSULAS CONTRACTUALES GENERALES RESUMIDAS (CONFIGURABLES)
    clausulas_texto = formatear_texto_reportlab(cfg_pdf.get("clausulas_venta"))

    clausulas_table = Table(
        [[Paragraph(clausulas_texto, style_clause)]],
        colWidths=[548],
    )
    clausulas_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )

    # 8. CONSTANCIA, ACEPTACIÓN Y FIRMAS (ESTRUCTURA SIMÉTRICA EN TRES COLUMNAS)
    # Empaquetado en KeepTogether para asegurar que las firmas nunca queden huérfanas
    firmas_block = []
    firmas_block.append(clausulas_table)
    firmas_block.append(Spacer(1, 10))

    # Cargar firmas digitales capturadas si existen
    firma_titular_b64 = (
        getattr(credito, "firma_cliente", None)
        or getattr(credito, "firma_titular", None)
        or obtener_firma_almacenada(credito.id_contrato, "cliente")
        or obtener_firma_almacenada(credito.id_contrato, "titular")
    )
    firma_vendedor_b64 = (
        getattr(credito, "firma_supervisor", None)
        or getattr(credito, "firma_vendedor", None)
        or getattr(credito, "firma_cajero", None)
        or obtener_firma_almacenada(credito.id_contrato, "supervisor")
        or obtener_firma_almacenada(credito.id_contrato, "vendedor")
        or obtener_firma_almacenada(credito.id_contrato, "cajero")
    )
    firma_codeudor_b64 = getattr(credito, "firma_codeudor", None) or obtener_firma_almacenada(credito.id_contrato, "codeudor")

    # Columna 1: Firma Titular / Deudor Principal
    sig_cliente = [
        crear_bloque_firma_imagen(firma_titular_b64, fallback_height=24),
        HRFlowable(width="85%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph(f"<b>ACEPTO Y RECIBÍ A SATISFACCIÓN</b><br/>{cliente_nombre}", style_signature_label),
        Paragraph(f"C.C. Nº: {cliente_cedula}", style_signature_sub),
        Paragraph("<font size='5.5' color='#64748B'>Firma Titular / Deudor Principal</font>", style_signature_sub),
    ]

    # Columna 2: Firma Codeudor Solidario (Reemplazo simétrico formal)
    if codeudor_info and codeudor_info.get("nombre"):
        cod_sig_nombre = codeudor_info.get("nombre")
        cod_sig_cedula = codeudor_info.get("cedula") or "No registrada"
    elif referencia_info and referencia_info.get("nombre"):
        cod_sig_nombre = f"{referencia_info.get('nombre')} ({referencia_info.get('parentesco', 'Garante')})"
        cod_sig_cedula = "Garantía de Respaldo"
    else:
        cod_sig_nombre = "Firma del Garante"
        cod_sig_cedula = "____________________"

    sig_codeudor = [
        crear_bloque_firma_imagen(firma_codeudor_b64, fallback_height=24),
        HRFlowable(width="85%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph(f"<b>FIRMA CODEUDOR SOLIDARIO</b><br/>{cod_sig_nombre}", style_signature_label),
        Paragraph(f"C.C. Nº: {cod_sig_cedula}", style_signature_sub),
        Paragraph("<font size='5.5' color='#64748B'>Codeudor Solidario y Mancomunado</font>", style_signature_sub),
    ]

    # Columna 3: Por Remundial Arte's (Firma Autorizada)
    razon_social_firma = m_cfg.get("razon_social") or "REMUNDIAL ARTE'S"
    ciudad_firma = m_cfg.get("ciudad") or "Montería - Córdoba"
    sig_remundial = [
        crear_bloque_firma_imagen(firma_vendedor_b64, fallback_height=24),
        HRFlowable(width="85%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph(f"<b>POR {razon_social_firma}</b><br/>{ciudad_firma}", style_signature_label),
        Paragraph(f"Asesor: {asesor_nombre}", style_signature_sub),
        Paragraph("<font size='5.5' color='#64748B'>Firma Autorizada / Sello Comercial</font>", style_signature_sub),
    ]

    # Columnas de firmas simétricas: Titular (182 pt), Codeudor (184 pt), Remundial (182 pt) = 548 pt
    firmas_table = Table(
        [[sig_cliente, sig_codeudor, sig_remundial]],
        colWidths=[182, 184, 182],
    )
    firmas_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    firmas_block.append(firmas_table)

    story.append(KeepTogether(firmas_block))

    # Construir PDF usando el canvas personalizado con paginación
    doc.build(story, canvasmaker=ReciboNumberedCanvas)
    buffer.seek(0)
    return buffer.getvalue()


def generar_pdf_recibo_abono(
    abono: Any,
    cobrador_nombre: Optional[str] = None,
    firma_cobrador: Optional[str] = None,
) -> bytes:
    """Genera un comprobante oficial de recaudo y abono a cartera en formato PDF.
    
    Estructura corporativa de recibo de caja para Remundial Arte's:
    - Encabezado oficial comercial de la empresa.
    - Metadatos del comprobante (N° REC-XXXX, Contrato CTR-XXXX, Fecha y Hora Local, Estado).
    - Datos del cliente titular y del cobrador / receptor autorizado.
    - Tarjetas de resumen financiero (Valor Abonado, Saldo Restante en Cartera, Medio de Pago).
    - Cláusula de validez contable.
    - Bloque de firmas simétrico (Cobrador y Cliente titular).
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=32,
        rightMargin=32,
        topMargin=28,
        bottomMargin=36,
    )

    story = []
    base_styles = getSampleStyleSheet()
    cfg_pdf = obtener_configuracion_pdf()
    m_cfg = cfg_pdf["membrete"]

    # Paleta de Colores
    c_primary = colors.HexColor("#0F172A")    # Slate-900
    c_emerald = colors.HexColor("#059669")    # Emerald-600
    c_emerald_bg = colors.HexColor("#ECFDF5") # Emerald-50
    c_slate_bg = colors.HexColor("#F8FAFC")   # Slate-50
    c_border = colors.HexColor("#E2E8F0")     # Slate-200
    c_text = colors.HexColor("#1E293B")       # Slate-800
    c_muted = colors.HexColor("#64748B")      # Slate-500

    # Tipografías y Estilos
    style_title = ParagraphStyle(
        "AbonoTitle",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=16,
        textColor=c_primary,
    )
    style_company_sub = ParagraphStyle(
        "AbonoCompanySub",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10,
        textColor=c_muted,
    )
    style_voucher_title = ParagraphStyle(
        "AbonoVoucherTitle",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=c_primary,
        alignment=2,
    )
    style_voucher_code = ParagraphStyle(
        "AbonoVoucherCode",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=14,
        textColor=c_emerald,
        alignment=2,
    )
    style_voucher_meta = ParagraphStyle(
        "AbonoVoucherMeta",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10,
        textColor=c_text,
        alignment=2,
    )
    style_section_heading = ParagraphStyle(
        "AbonoSectionHeading",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=10,
        textColor=c_primary,
    )
    style_card_label = ParagraphStyle(
        "AbonoCardLabel",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=9,
        textColor=c_muted,
    )
    style_card_value = ParagraphStyle(
        "AbonoCardValue",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        textColor=c_text,
    )
    style_amount_big = ParagraphStyle(
        "AbonoAmountBig",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=17,
        textColor=c_emerald,
    )
    style_amount_slate = ParagraphStyle(
        "AbonoAmountSlate",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=15,
        textColor=c_primary,
    )
    style_signature_label = ParagraphStyle(
        "AbonoSigLabel",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        textColor=c_primary,
        alignment=1,
    )
    style_signature_sub = ParagraphStyle(
        "AbonoSigSub",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=8.5,
        textColor=c_muted,
        alignment=1,
    )

    # 1. EXTRACCIÓN Y FORMATEO DE METADATOS
    id_rec_str = str(getattr(abono, "id_recibo", "") or "REC-0000").strip().upper()
    if id_rec_str.startswith("ABONO-OFF-") or id_rec_str.startswith("REC-") or id_rec_str.startswith("OFF-"):
        codigo_rec = id_rec_str[:16]
    else:
        codigo_rec = f"REC-{id_rec_str[:8]}"

    ctr_raw = str(getattr(abono, "numero_contrato", None) or getattr(abono, "credito_id", "") or "CTR-RUTA").strip().upper()
    if ctr_raw.startswith("CTR-"):
        codigo_ctr = ctr_raw
    else:
        codigo_ctr = f"CTR-{ctr_raw[:8]}"
    dt_abono = (
        getattr(abono, "fecha_completa", None)
        or getattr(abono, "fecha", None)
        or getattr(abono, "creado_en", None)
        or getattr(abono, "fecha_pago", None)
        or datetime.now()
    )
    dt_local = obtener_timestamp_local_servidor(dt_abono)
    fecha_abono_str = dt_local.strftime("%Y-%m-%d %H:%M:%S")
    ReciboNumberedCanvas.fecha_impresion = fecha_abono_str

    raw_estado = (abono.estado.value if hasattr(abono.estado, "value") else str(abono.estado)).lower()
    if raw_estado == "conciliado":
        estado_label = "CONCILIADO EN CAJA"
        estado_color = "#059669"
    elif raw_estado == "anulado":
        estado_label = "ANULADO"
        estado_color = "#DC2626"
    else:
        estado_label = "REGISTRADO / EN RUTA"
        estado_color = "#0284C7"

    valor_abonado_val = Decimal(str(getattr(abono, "valor_abonado", 0) or 0))
    metodo_pago_str = (getattr(abono, "metodo_pago", None) or "efectivo").upper()

    # Resolver Participantes
    credito = getattr(abono, "credito", None)
    cliente = getattr(credito, "cliente", None) if credito else None
    cliente_nombre = getattr(cliente, "nombres", None) or getattr(abono, "cliente_nombre", "Cliente Titular")
    cliente_cedula = getattr(cliente, "cedula", None) or getattr(abono, "cliente_cedula", "S/N")
    cliente_tel = getattr(cliente, "telefono", "No registrado") if cliente else "No registrado"
    cliente_dir = getattr(cliente, "direccion", "Montería, Córdoba") if cliente else "Montería, Córdoba"
    cliente_barrio = getattr(cliente, "barrio", "Centro") if cliente else "Centro"
    cliente_ciudad = getattr(cliente, "ciudad", "Montería") if cliente else "Montería"

    cobrador = getattr(abono, "cobrador", None)
    c_nom_raw = (
        cobrador_nombre
        or getattr(abono, "cobrador_nombre", None)
        or (getattr(cobrador, "nombre", None) if cobrador else None)
        or (getattr(cobrador, "nombre_completo", None) if cobrador else None)
        or (getattr(cobrador, "nombres", None) if cobrador else None)
    )
    if c_nom_raw and str(c_nom_raw).strip() and str(c_nom_raw).strip().lower() not in ["none", "null"]:
        cobrador_nombre = str(c_nom_raw).strip()
    else:
        cobrador_nombre = "Pedro Cobrador"
    cobrador_tel = (
        (getattr(cobrador, "telefono", None) if cobrador else None)
        or getattr(abono, "cobrador_telefono", None)
        or "No registrado"
    )

    saldo_restante_val = (
        Decimal(str(credito.saldo_pendiente))
        if credito and getattr(credito, "saldo_pendiente", None) is not None
        else Decimal(str(getattr(abono, "saldo_restante_credito", 0) or 0))
    )
    monto_financiado_val = Decimal(str(getattr(credito, "monto_financiado", 0) or 0)) if credito else Decimal("0.00")
    total_cuotas_str = str(getattr(credito, "numero_cuotas", "-")) if credito else "-"
    valor_cuota_val = Decimal(str(getattr(credito, "valor_cuota", 0) or 0)) if credito else Decimal("0.00")

    # 2. CÁLCULO PRECISO: PAGO TOTAL DE CUOTA VS ABONO PARCIAL Y SALDO INSOLUTO
    es_abono_parcial = getattr(abono, "es_abono_parcial", None)
    if es_abono_parcial is None:
        if valor_cuota_val > Decimal("0.00") and valor_abonado_val < valor_cuota_val and saldo_restante_val > Decimal("0.00"):
            es_abono_parcial = True
        else:
            es_abono_parcial = False

    saldo_insoluto_val = Decimal(str(getattr(abono, "diferencia_arrastrada", 0) or 0))
    if es_abono_parcial and saldo_insoluto_val <= Decimal("0.00") and valor_cuota_val > valor_abonado_val:
        saldo_insoluto_val = valor_cuota_val - valor_abonado_val

    cuota_afectada_num = getattr(abono, "cuota_afectada_numero", None) or getattr(abono, "numero_cuota", None) or 1
    cuota_siguiente_num = cuota_afectada_num + 1

    valor_cuota_siguiente_val = getattr(abono, "valor_cuota_siguiente", None)
    if valor_cuota_siguiente_val is None:
        valor_cuota_siguiente_val = (valor_cuota_val + saldo_insoluto_val) if es_abono_parcial else valor_cuota_val
    else:
        valor_cuota_siguiente_val = Decimal(str(valor_cuota_siguiente_val))

    if es_abono_parcial:
        voucher_main_title = "RECIBO DE CAJA - ABONO PARCIAL"
        tipo_recibo_badge = "ABONO PARCIAL (SALDO INSOLUTO TRASLADADO)"
        tipo_badge_color = "#D97706"  # Ámbar oscuro
    else:
        voucher_main_title = "RECIBO DE CAJA - PAGO DE CUOTA"
        tipo_recibo_badge = "PAGO TOTAL DE CUOTA"
        tipo_badge_color = "#059669"  # Verde esmeralda

    # 3. ENCABEZADO OFICIAL PERSONALIZADO
    header_col_izq = [
        Paragraph(m_cfg.get("razon_social") or "REMUNDIAL ARTE'S", style_title),
        Spacer(1, 2),
        Paragraph(
            construir_lineas_membrete_sub(m_cfg, tipo_contacto="Cobranzas"),
            style_company_sub,
        ),
    ]

    header_col_der = [
        Paragraph(voucher_main_title, style_voucher_title),
        Paragraph(codigo_rec, style_voucher_code),
        Spacer(1, 2),
        Paragraph(
            f"<b>Contrato Asociado:</b> {codigo_ctr}<br/>"
            f"<b>Modalidad de Recaudo:</b> <font color='{tipo_badge_color}'><b>{tipo_recibo_badge}</b></font><br/>"
            f"<b>Fecha de Recaudo:</b> {fecha_abono_str}<br/>"
            f"<b>Cobrador en Ruta:</b> {cobrador_nombre}<br/>"
            f"<b>Medio de Pago:</b> {metodo_pago_str}<br/>"
            f"<b>Estado Caja:</b> <font color='{estado_color}'><b>{estado_label}</b></font>",
            style_voucher_meta,
        ),
    ]

    header_table = Table(
        [[header_col_izq, header_col_der]],
        colWidths=[305, 243],
    )
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=1, color=c_primary, spaceBefore=4, spaceAfter=8))

    # 4. DATOS DEL CLIENTE Y DEL RECAUDADOR
    cliente_block = [
        Paragraph("DATOS DEL CLIENTE (TITULAR DE CARTERA)", style_section_heading),
        Spacer(1, 3),
        Paragraph(
            f"<b>Nombre Completo:</b> {cliente_nombre}<br/>"
            f"<b>Cédula / Documento:</b> {cliente_cedula}<br/>"
            f"<b>Teléfono de Contacto:</b> {cliente_tel}<br/>"
            f"<b>Dirección Cobro:</b> {cliente_dir}<br/>"
            f"<b>Barrio / Ciudad:</b> {cliente_barrio}, {cliente_ciudad}",
            style_card_value,
        ),
    ]

    cobrador_block = [
        Paragraph("GESTIÓN DE RECAUDO & CARTERA", style_section_heading),
        Spacer(1, 3),
        Paragraph(
            f"<b>Cobrador / Receptor:</b> {cobrador_nombre}<br/>"
            f"<b>Teléfono / Contacto:</b> {cobrador_tel}<br/>"
            f"<b>Modalidad de Recaudo:</b> En Terreno / Ruta Asignada<br/>"
            f"<b>Método Liquidado:</b> {metodo_pago_str}<br/>"
            f"<b>Certificación:</b> Recaudo con verificación digital auditada",
            style_card_value,
        ),
    ]

    partes_table = Table(
        [[cliente_block, cobrador_block]],
        colWidths=[270, 278],
    )
    partes_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (0, 0), c_slate_bg),
                ("BACKGROUND", (1, 0), (1, 0), c_slate_bg),
                ("BOX", (0, 0), (0, 0), 0.5, c_border),
                ("BOX", (1, 0), (1, 0), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(partes_table)
    story.append(Spacer(1, 8))

    # 5. TARJETAS DE IMPACTO FINANCIERO DIFERENCIADAS (PAGO TOTAL VS ABONO PARCIAL)
    if es_abono_parcial:
        card_1 = [
            Paragraph("MONTO ABONADO (RECIBO)", style_card_label),
            Spacer(1, 2),
            Paragraph(f"<b>{format_cop(valor_abonado_val)}</b>", style_amount_big),
            Paragraph(f"<font size='6.5' color='#059669'>Abono a Cuota #{cuota_afectada_num}</font>", style_company_sub),
        ]
        card_2 = [
            Paragraph("VALOR CUOTA EXIGIBLE", style_card_label),
            Spacer(1, 2),
            Paragraph(f"<b>{format_cop(valor_cuota_val)}</b>", style_amount_slate),
            Paragraph(f"<font size='6.5' color='#64748B'>Valor base cuota mensual</font>", style_company_sub),
        ]
        card_3 = [
            Paragraph("SALDO INSOLUTO (CUOTA)", style_card_label),
            Spacer(1, 2),
            Paragraph(f"<b><font color='#DC2626'>{format_cop(saldo_insoluto_val)}</font></b>", style_amount_slate),
            Paragraph(f"<font size='6.5' color='#DC2626'>Pendiente por trasladar</font>", style_company_sub),
        ]
        card_4 = [
            Paragraph("EXIGIBLE SIGUIENTE CUOTA", style_card_label),
            Spacer(1, 2),
            Paragraph(f"<b>{format_cop(valor_cuota_siguiente_val)}</b>", style_amount_slate),
            Paragraph(f"<font size='6.5' color='#0F172A'>Cuota #{cuota_siguiente_num} (Base + Insoluto)</font>", style_company_sub),
        ]
        bg_card_3 = colors.HexColor("#FEF2F2")
    else:
        card_1 = [
            Paragraph("VALOR CUOTA CANCELADA", style_card_label),
            Spacer(1, 2),
            Paragraph(f"<b>{format_cop(valor_abonado_val)}</b>", style_amount_big),
            Paragraph(f"<font size='6.5' color='#059669'>Cuota #{cuota_afectada_num} cubierta 100%</font>", style_company_sub),
        ]
        card_2 = [
            Paragraph("SALDO INSOLUTO EN CUOTA", style_card_label),
            Spacer(1, 2),
            Paragraph("<b>$ 0</b>", style_amount_slate),
            Paragraph("<font size='6.5' color='#059669'>Sin saldo remanente</font>", style_company_sub),
        ]
        card_3 = [
            Paragraph("EXIGIBILIDAD SIGUIENTE CUOTA", style_card_label),
            Spacer(1, 2),
            Paragraph(f"<b>{format_cop(valor_cuota_siguiente_val)}</b>", style_amount_slate),
            Paragraph(f"<font size='6.5' color='#64748B'>Cuota #{cuota_siguiente_num} ordinaria</font>", style_company_sub),
        ]
        card_4 = [
            Paragraph("SALDO RESTANTE CONTRATO", style_card_label),
            Spacer(1, 2),
            Paragraph(f"<b>{format_cop(saldo_restante_val)}</b>", style_amount_slate),
            Paragraph(f"<font size='6.5' color='#64748B'>Capital pendiente global</font>", style_company_sub),
        ]
        bg_card_3 = c_slate_bg

    cards_table = Table(
        [[card_1, card_2, card_3, card_4]],
        colWidths=[137, 137, 137, 137],
    )
    cards_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), c_emerald_bg),
                ("BACKGROUND", (1, 0), (1, 0), c_slate_bg),
                ("BACKGROUND", (2, 0), (2, 0), bg_card_3),
                ("BACKGROUND", (3, 0), (3, 0), c_slate_bg),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(cards_table)
    story.append(Spacer(1, 7))

    # 6. BANNER / CALLOUT EXPLICATIVO DE SALDO INSOLUTO Y REGLA DE ARRASTRE
    if es_abono_parcial:
        callout_content = [
            Paragraph(
                "<b>⚠️ AVISO DE APLICACIÓN DE ABONO PARCIAL Y TRASLADO DE SALDO INSOLUTO:</b><br/>"
                f"El presente comprobante certifica un <b>Abono Parcial</b> de <b>{format_cop(valor_abonado_val)}</b> "
                f"aplicado a la <b>Cuota #{cuota_afectada_num}</b> (cuyo valor exigible es de {format_cop(valor_cuota_val)}). "
                f"El saldo insoluto no cubierto de <b><font color='#DC2626'>{format_cop(saldo_insoluto_val)}</font></b> "
                f"<b>se traslada y suma automáticamente a la exigibilidad de la Cuota #{cuota_siguiente_num}</b>, "
                f"fijando un nuevo valor a cobrar de <b>{format_cop(valor_cuota_siguiente_val)}</b> para el próximo periodo.<br/>"
                f"<i>Saldo total remanente en cartera: {format_cop(saldo_restante_val)}</i>",
                style_card_value,
            )
        ]
        callout_table = Table([[callout_content]], colWidths=[548])
        callout_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFFBEB")),
                    ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#FCD34D")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
    else:
        callout_content = [
            Paragraph(
                "<b>✓ CERTIFICACIÓN DE PAGO TOTAL DE CUOTA:</b><br/>"
                f"Se certifica el <b>Pago Total y oportuno de la Cuota #{cuota_afectada_num}</b> "
                f"por valor de <b>{format_cop(valor_abonado_val)}</b>. La cuota queda satisfecha al 100% "
                f"sin generar saldos insolutos de arrastre. La <b>Cuota #{cuota_siguiente_num}</b> conservará su valor ordinario "
                f"programado de <b>{format_cop(valor_cuota_siguiente_val)}</b>.<br/>"
                f"<i>Saldo total remanente en cartera: {format_cop(saldo_restante_val)}</i>",
                style_card_value,
            )
        ]
        callout_table = Table([[callout_content]], colWidths=[548])
        callout_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F0FDF4")),
                    ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#86EFAC")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
    story.append(callout_table)
    story.append(Spacer(1, 8))

    # 7. TABLA DE RESUMEN DE APLICACIÓN DEL PAGO
    resumen_heading = Table(
        [[Paragraph("DETALLE Y APLICACIÓN CONTABLE DEL RECAUDO", style_section_heading)]],
        colWidths=[548],
    )
    resumen_heading.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(resumen_heading)
    story.append(Spacer(1, 3))

    concepto_str = (
        f"Abono Parcial Cuota #{cuota_afectada_num} (Insoluto: {format_cop(saldo_insoluto_val)})"
        if es_abono_parcial
        else f"Pago Total Cuota #{cuota_afectada_num}"
    )

    detalles_pago = [
        [
            Paragraph("<b>Concepto</b>", style_card_label),
            Paragraph("<b>Referencia / Documento</b>", style_card_label),
            Paragraph("<b>Forma de Pago</b>", style_card_label),
            Paragraph("<b>Saldo Insoluto</b>", style_card_label),
            Paragraph("<b>Monto Recaudado</b>", style_card_label),
        ],
        [
            Paragraph(concepto_str, style_card_value),
            Paragraph(f"Contrato {codigo_ctr}", style_card_value),
            Paragraph(metodo_pago_str, style_card_value),
            Paragraph(f"<font color='{'#DC2626' if es_abono_parcial else '#64748B'}'>{format_cop(saldo_insoluto_val)}</font>", style_card_value),
            Paragraph(f"<b>{format_cop(valor_abonado_val)}</b>", style_card_value),
        ],
    ]
    detalles_table = Table(detalles_pago, colWidths=[155, 100, 95, 100, 98])
    detalles_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                ("ALIGN", (3, 0), (4, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(detalles_table)
    story.append(Spacer(1, 8))

    # 6. DECLARACIÓN DE VALIDEZ LEGAL (CONFIGURABLE)
    legal_text = formatear_texto_reportlab(cfg_pdf.get("certificacion_recaudo"))
    legal_table = Table([[Paragraph(legal_text, style_company_sub)]], colWidths=[548])
    legal_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(legal_table)
    story.append(Spacer(1, 20))

    # 7. BLOQUE DE FIRMAS SIMÉTRICO (Cobrador y Cliente)
    firmas_block = []
    firma_cobrador_b64 = (
        firma_cobrador
        or getattr(abono, "firma_cobrador", None)
        or obtener_firma_almacenada(abono.id_recibo, "cobrador")
    )
    firma_cliente_b64 = (
        getattr(abono, "firma_cliente", None)
        or obtener_firma_almacenada(abono.id_recibo, "cliente")
        or (obtener_firma_almacenada(abono.credito_id, "titular") if getattr(abono, "credito_id", None) else None)
    )

    razon_social_abono = m_cfg.get("razon_social") or "Remundial Arte's"
    ciudad_abono = m_cfg.get("ciudad") or "Montería"
    sig_cobrador = [
        crear_bloque_firma_imagen(firma_cobrador_b64, fallback_height=24),
        HRFlowable(width="80%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph("<b>COBRADOR AUTORIZADO EN RUTA</b>", style_signature_label),
        Paragraph(f"<b>{cobrador_nombre}</b>", style_signature_label),
        Paragraph(f"{razon_social_abono} • {ciudad_abono}", style_signature_sub),
        Paragraph("<font size='5.5' color='#64748B'>Firma y Sello de Recaudo Oficial</font>", style_signature_sub),
    ]

    sig_cliente = [
        crear_bloque_firma_imagen(firma_cliente_b64, fallback_height=24),
        HRFlowable(width="80%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph("<b>CLIENTE / DEUDOR TITULAR</b>", style_signature_label),
        Paragraph(f"<b>{cliente_nombre}</b>", style_signature_label),
        Paragraph(f"C.C. Nº: {cliente_cedula}", style_signature_sub),
        Paragraph("<font size='5.5' color='#64748B'>Conformidad de Pago y Saldo</font>", style_signature_sub),
    ]

    firmas_table = Table(
        [[sig_cobrador, sig_cliente]],
        colWidths=[274, 274],
    )
    firmas_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    firmas_block.append(firmas_table)
    story.append(KeepTogether(firmas_block))

    doc.build(story, canvasmaker=ReciboNumberedCanvas)
    buffer.seek(0)
    return buffer.getvalue()


def generar_pdf_acta_restitucion(
    credito: Any,
    motivo: Optional[str] = None,
    cobrador_nombre: Optional[str] = None,
    firma_cliente_b64: Optional[str] = None,
    firma_cobrador_b64: Optional[str] = None,
    observaciones: Optional[str] = None,
    fecha_hora: Optional[Any] = None,
) -> bytes:
    """Genera en tiempo real el Acta Oficial de Restitución de Bienes por Mora Crítica (>= 3 cuotas) en formato PDF."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )
    story = []
    cfg_pdf = obtener_configuracion_pdf()
    m_cfg = cfg_pdf["membrete"]
    acta_cfg = cfg_pdf.get("acta_restitucion", {})

    # Paleta corporativa de alerta y formalidad legal
    c_primary = colors.HexColor("#0F172A")
    c_secondary = colors.HexColor("#334155")
    c_crimson = colors.HexColor("#991B1B")
    c_crimson_bg = colors.HexColor("#FEF2F2")
    c_crimson_border = colors.HexColor("#FCA5A5")
    c_slate_bg = colors.HexColor("#F8FAFC")
    c_border = colors.HexColor("#CBD5E1")
    c_muted = colors.HexColor("#64748B")

    styles = getSampleStyleSheet()

    style_title = ParagraphStyle(
        "ActaTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12.5,
        leading=15,
        alignment=1,
        textColor=c_crimson,
    )
    style_subtitle = ParagraphStyle(
        "ActaSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        alignment=1,
        textColor=c_secondary,
    )
    style_company_name = ParagraphStyle(
        "ActaCompany",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=13,
        textColor=c_primary,
    )
    style_company_sub = ParagraphStyle(
        "ActaCompanySub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=9,
        textColor=c_muted,
    )
    style_doc_box_title = ParagraphStyle(
        "ActaDocBoxTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=11,
        alignment=1,
        textColor=c_crimson,
    )
    style_doc_box_meta = ParagraphStyle(
        "ActaDocBoxMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10,
        alignment=1,
        textColor=c_primary,
    )
    style_section_header = ParagraphStyle(
        "ActaSectionHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.white,
    )
    style_field_label = ParagraphStyle(
        "ActaFieldLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8.5,
        textColor=c_muted,
    )
    style_field_value = ParagraphStyle(
        "ActaFieldValue",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        textColor=c_primary,
    )
    style_alert_title = ParagraphStyle(
        "ActaAlertTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=c_crimson,
    )
    style_alert_text = ParagraphStyle(
        "ActaAlertText",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#7F1D1D"),
    )
    style_table_header = ParagraphStyle(
        "ActaTableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8.5,
        alignment=1,
        textColor=colors.white,
    )
    style_table_cell = ParagraphStyle(
        "ActaTableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=8.5,
        textColor=c_primary,
    )
    style_table_cell_center = ParagraphStyle(
        "ActaTableCellCenter",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=8.5,
        alignment=1,
        textColor=c_primary,
    )
    style_legal_text = ParagraphStyle(
        "ActaLegalText",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=6.5,
        leading=8.5,
        alignment=4,  # Justified
        textColor=c_secondary,
    )
    style_signature_label = ParagraphStyle(
        "ActaSignatureLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9,
        alignment=1,
        textColor=c_primary,
    )
    style_signature_sub = ParagraphStyle(
        "ActaSignatureSub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=6.5,
        leading=8,
        alignment=1,
        textColor=c_muted,
    )

    # Identificación del contrato y cliente
    cid_raw = str(getattr(credito, "id_contrato", None) or "CTR-GRAL")
    cid_clean = cid_raw.strip().lower()
    cid_short = cid_clean[:8].upper()
    acta_id = f"ACTA-{cid_short}"
    contrato_id = f"CTR-{cid_short}"

    cliente = getattr(credito, "cliente", None)
    cliente_nombre = "Cliente Titular"
    cliente_cedula = "No registrada"
    cliente_tel = "No registrado"
    cliente_dir = "No registrada"
    cliente_barrio = ""
    cliente_ciudad = "Montería"

    if cliente:
        noms = getattr(cliente, "nombres", "") or ""
        apes = getattr(cliente, "apellidos", "") or ""
        cliente_nombre = f"{noms} {apes}".strip() or "Cliente Titular"
        cliente_cedula = getattr(cliente, "documento_numero", None) or getattr(cliente, "cedula", None) or "No registrada"
        cliente_tel = getattr(cliente, "telefono", None) or "No registrado"
        cliente_dir = getattr(cliente, "direccion", None) or "No registrada"
        cliente_barrio = getattr(cliente, "barrio", "") or ""
        cliente_ciudad = getattr(cliente, "ciudad", "") or "Montería"

    # Codeudor si existe
    codeudor = getattr(credito, "codeudor", None)
    codeudor_info = "No aplica"
    if codeudor:
        cod_nom = codeudor.get("nombre") if isinstance(codeudor, dict) else getattr(codeudor, "nombre", "")
        cod_doc = codeudor.get("cedula") if isinstance(codeudor, dict) else getattr(codeudor, "cedula", "")
        if cod_nom:
            codeudor_info = f"{cod_nom} (C.C. {cod_doc})" if cod_doc else cod_nom

    # Timestamp local del servidor
    dt_local = obtener_timestamp_local_servidor(fecha_hora)
    dt_local_str = dt_local.strftime("%Y-%m-%d %H:%M:%S")

    # Cobrador
    cobrador_obj = getattr(credito, "cobrador", None)
    cobrador_nombre_final = (
        cobrador_nombre
        or (getattr(cobrador_obj, "nombre_completo", None) if cobrador_obj else None)
        or (getattr(cobrador_obj, "nombre", None) if cobrador_obj else None)
        or "Gestor de Cobro Autorizado"
    )

    # Cuotas vencidas
    cuotas_vencidas_num = getattr(credito, "cuotas_vencidas_count", 0)
    if not cuotas_vencidas_num and hasattr(credito, "cronograma_cuotas") and credito.cronograma_cuotas:
        cuotas_vencidas_num = sum(1 for q in credito.cronograma_cuotas if getattr(q, "estado", "") == "vencida")
    if not cuotas_vencidas_num and getattr(credito, "fecha_primera_cuota", None):
        res_cron = generar_cronograma_con_arrastre(
            fecha_primera_cuota=credito.fecha_primera_cuota,
            numero_cuotas=credito.numero_cuotas,
            monto_financiado=credito.monto_financiado or Decimal("0.00"),
            saldo_pendiente=credito.saldo_pendiente or Decimal("0.00"),
            valor_cuota_base=credito.valor_cuota or Decimal("0.00"),
            tipo_pago=credito.tipo_pago or TipoPago.MENSUAL,
        )
        cuotas_vencidas_num = res_cron.get("cuotas_vencidas_count", 3)

    # 1. ENCABEZADO CORPORATIVO PERSONALIZADO
    razon_social_acta = m_cfg.get("razon_social") or "REMUNDIAL ARTE'S"
    nit_acta = m_cfg.get("nit") or "900.123.456-7"
    regimen_acta = m_cfg.get("regimen") or "Régimen Común"
    dir_acta = m_cfg.get("direccion") or "Calle 29 # 4-56, Centro"
    ciu_acta = m_cfg.get("ciudad") or "Montería, Córdoba"
    pbx_acta = m_cfg.get("telefono_pbx") or "300 123 4567"
    obs_acta_default = acta_cfg.get("observaciones_defecto") or "Departamento de Cartera y Recuperación de Bienes"

    header_left = [
        Paragraph(f"<b>{razon_social_acta}</b>", style_company_name),
        Paragraph(f"NIT: {nit_acta} • {regimen_acta}", style_company_sub),
        Paragraph(f"Dirección: {dir_acta} • {ciu_acta}", style_company_sub),
        Paragraph(f"PBX / Contacto: {pbx_acta}", style_company_sub),
        Paragraph(obs_acta_default, style_company_sub),
    ]

    header_right = [
        Paragraph("<b>ACTA DE RESTITUCIÓN</b>", style_doc_box_title),
        Spacer(1, 2),
        Paragraph(f"<b>Nº: {acta_id}</b>", style_doc_box_meta),
        Paragraph(f"<b>CONTRATO: {contrato_id}</b>", style_doc_box_meta),
        Spacer(1, 2),
        Paragraph(f"<b>FECHA Y HORA LOCAL:</b><br/>{dt_local_str}", style_doc_box_meta),
    ]

    header_table = Table([[header_left, header_right]], colWidths=[350, 190])
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (1, 0), (1, 0), c_crimson_bg),
                ("BOX", (1, 0), (1, 0), 1, c_crimson_border),
                ("LEFTPADDING", (1, 0), (1, 0), 8),
                ("RIGHTPADDING", (1, 0), (1, 0), 8),
                ("TOPPADDING", (1, 0), (1, 0), 6),
                ("BOTTOMPADDING", (1, 0), (1, 0), 6),
            ]
        )
    )
    story.append(header_table)
    story.append(Spacer(1, 8))

    # Título principal del documento
    story.append(Paragraph("ACTA DE RESTITUCIÓN Y RETIRO DE BIENES POR MORA CRÍTICA", style_title))
    story.append(Paragraph("DILIGENCIA OFICIAL DE RECUPERACIÓN PRENDARIA POR INCUMPLIMIENTO CONTRACTUAL (≥ 3 CUOTAS)", style_subtitle))
    story.append(Spacer(1, 8))

    # 2. DATOS DEL DEUDOR Y CONTRATO
    banner_deudor = Table(
        [[Paragraph("<b>1. DATOS GENERALES DEL CLIENTE DEUDOR Y CONTRATO</b>", style_section_header)]],
        colWidths=[540],
    )
    banner_deudor.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), c_primary),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(banner_deudor)

    deudor_data = [
        [
            Paragraph("CLIENTE / DEUDOR TITULAR:", style_field_label),
            Paragraph(f"<b>{cliente_nombre}</b>", style_field_value),
            Paragraph("CÉDULA / NIT:", style_field_label),
            Paragraph(f"<b>{cliente_cedula}</b>", style_field_value),
        ],
        [
            Paragraph("DIRECCIÓN DE DOMICILIO:", style_field_label),
            Paragraph(f"{cliente_dir}", style_field_value),
            Paragraph("TELÉFONO DE CONTACTO:", style_field_label),
            Paragraph(f"{cliente_tel}", style_field_value),
        ],
        [
            Paragraph("BARRIO Y CIUDAD:", style_field_label),
            Paragraph(f"{cliente_barrio}, {cliente_ciudad}" if cliente_barrio else cliente_ciudad, style_field_value),
            Paragraph("CODEUDOR SOLIDARIO:", style_field_label),
            Paragraph(f"{codeudor_info}", style_field_value),
        ],
    ]
    table_deudor = Table(deudor_data, colWidths=[120, 180, 110, 130])
    table_deudor.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), c_slate_bg),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(table_deudor)
    story.append(Spacer(1, 8))

    # 3. ESTADO FINANCIERO Y MOTIVO DE RESTITUCIÓN
    banner_motivo = Table(
        [[Paragraph("<b>2. ESTADO FINANCIERO Y MOTIVO DE LA RESTITUCIÓN</b>", style_section_header)]],
        colWidths=[540],
    )
    banner_motivo.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), c_primary),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(banner_motivo)

    fin_box_1 = [
        Paragraph("MONTO FINANCIADO", style_field_label),
        Spacer(1, 2),
        Paragraph(f"<b>{format_cop(credito.monto_financiado)}</b>", style_field_value),
    ]
    fin_box_2 = [
        Paragraph("SALDO PENDIENTE INSOLUTO", style_field_label),
        Spacer(1, 2),
        Paragraph(f"<b><font color='#991B1B'>{format_cop(credito.saldo_pendiente)}</font></b>", style_field_value),
    ]
    fin_box_3 = [
        Paragraph("PLAZO TOTAL PACTADO", style_field_label),
        Spacer(1, 2),
        Paragraph(f"<b>{credito.numero_cuotas} Cuotas ({credito.tipo_pago})</b>", style_field_value),
    ]
    fin_box_4 = [
        Paragraph("CUOTAS EN MORA CRÍTICA", style_field_label),
        Spacer(1, 2),
        Paragraph(f"<b><font color='#991B1B'>🚨 {cuotas_vencidas_num} Vencidas (≥ 3)</font></b>", style_field_value),
    ]

    table_fin = Table([[fin_box_1, fin_box_2, fin_box_3, fin_box_4]], colWidths=[135, 135, 135, 135])
    table_fin.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), c_slate_bg),
                ("BACKGROUND", (1, 0), (1, 0), c_crimson_bg),
                ("BACKGROUND", (2, 0), (2, 0), c_slate_bg),
                ("BACKGROUND", (3, 0), (3, 0), c_crimson_bg),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(table_fin)

    # Callout de causal y observaciones
    motivo_texto = motivo or f"Incumplimiento reiterado en el pago del crédito con acumulación de {cuotas_vencidas_num} cuotas morosas vencidas, configurando la causal de restitución de bienes pactada contractualmente."
    obs_texto = observaciones or "Diligencia presencial realizada en el domicilio del deudor para la recuperación y custodia de los bienes muebles."

    callout_data = [
        [
            Paragraph("<b>CAUSAL LEGAL DE RESTITUCIÓN:</b>", style_alert_title),
            Paragraph(motivo_texto, style_alert_text),
        ],
        [
            Paragraph("<b>OBSERVACIONES DE LA DILIGENCIA:</b>", style_field_label),
            Paragraph(obs_texto, style_field_value),
        ],
    ]
    table_callout = Table(callout_data, colWidths=[150, 390])
    table_callout.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), c_crimson_bg),
                ("BACKGROUND", (0, 1), (-1, 1), c_slate_bg),
                ("BOX", (0, 0), (-1, -1), 0.5, c_crimson_border),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(table_callout)
    story.append(Spacer(1, 8))

    # 4. ARTÍCULOS SUJETOS A RESTITUCIÓN
    banner_articulos = Table(
        [[Paragraph("<b>3. ARTÍCULOS E INVENTARIO SUJETO A RESTITUCIÓN Y RETIRO</b>", style_section_header)]],
        colWidths=[540],
    )
    banner_articulos.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), c_primary),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(banner_articulos)

    articulos_rows = [
        [
            Paragraph("<b>#</b>", style_table_header),
            Paragraph("<b>DESCRIPCIÓN DEL ARTÍCULO / PRODUCTO</b>", style_table_header),
            Paragraph("<b>SKU / CÓDIGO</b>", style_table_header),
            Paragraph("<b>CANT.</b>", style_table_header),
            Paragraph("<b>ESTADO DE ENTREGA</b>", style_table_header),
        ]
    ]

    detalles = getattr(credito, "detalles", []) or []
    if detalles:
        for idx, d in enumerate(detalles):
            prod = getattr(d, "producto", None)
            nom = getattr(prod, "nombre", None) or getattr(d, "descripcion", "Artículo comercial")
            sku = getattr(prod, "sku", None) or getattr(prod, "codigo", "-")
            cant = str(getattr(d, "cantidad", 1))
            articulos_rows.append(
                [
                    Paragraph(str(idx + 1), style_table_cell_center),
                    Paragraph(f"<b>{nom}</b>", style_table_cell),
                    Paragraph(sku, style_table_cell_center),
                    Paragraph(cant, style_table_cell_center),
                    Paragraph("<font color='#991B1B'>Retirado en diligencia</font>", style_table_cell_center),
                ]
            )
    else:
        articulos_rows.append(
            [
                Paragraph("1", style_table_cell_center),
                Paragraph("<b>Artículos de mobiliario / enseres pactados en contrato de crédito</b>", style_table_cell),
                Paragraph("GLOBAL", style_table_cell_center),
                Paragraph("1", style_table_cell_center),
                Paragraph("<font color='#991B1B'>Retirado en diligencia</font>", style_table_cell_center),
            ]
        )

    table_articulos = Table(articulos_rows, colWidths=[25, 255, 95, 45, 120])
    table_articulos.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), c_secondary),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(table_articulos)
    story.append(Spacer(1, 8))

    # 5. CLÁUSULA LEGAL DE RESTITUCIÓN (CONFIGURABLE)
    legal_text = formatear_texto_reportlab(acta_cfg.get("clausula_legal"))
    table_legal = Table([[Paragraph(legal_text, style_legal_text)]], colWidths=[540])
    table_legal.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), c_slate_bg),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(table_legal)
    story.append(Spacer(1, 14))

    # 6. DOBLE FIRMA DIGITAL ESTRUCTURADA (Cliente y Cobrador)
    firma_cliente_final = (
        firma_cliente_b64
        or obtener_firma_almacenada(cid_clean, "acta_cliente")
        or obtener_firma_almacenada(cid_clean, "titular")
        or obtener_firma_almacenada(cid_clean, "cliente")
    )
    firma_cobrador_final = (
        firma_cobrador_b64
        or obtener_firma_almacenada(cid_clean, "acta_cobrador")
        or obtener_firma_almacenada(cid_clean, "cobrador")
    )

    sig_cliente = [
        crear_bloque_firma_imagen(firma_cliente_final, fallback_height=26),
        HRFlowable(width="85%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph("<b>CLIENTE / DEUDOR TITULAR</b>", style_signature_label),
        Paragraph(f"<b>{cliente_nombre}</b>", style_signature_label),
        Paragraph(f"C.C. Nº: {cliente_cedula}", style_signature_sub),
        Paragraph("<font size='6' color='#991B1B'>Entrega bienes a entera conformidad</font>", style_signature_sub),
        Paragraph(f"<font size='5.5' color='#64748B'>Fecha/Hora: {dt_local_str}</font>", style_signature_sub),
    ]

    sig_cobrador = [
        crear_bloque_firma_imagen(firma_cobrador_final, fallback_height=26),
        HRFlowable(width="85%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph("<b>GESTOR / COBRADOR AUTORIZADO EN RUTA</b>", style_signature_label),
        Paragraph(f"<b>{cobrador_nombre_final}</b>", style_signature_label),
        Paragraph("Remundial Arte's • Montería", style_signature_sub),
        Paragraph("<font size='6' color='#059669'>Recibe bienes en custodia oficial</font>", style_signature_sub),
        Paragraph(f"<font size='5.5' color='#64748B'>Fecha/Hora: {dt_local_str}</font>", style_signature_sub),
    ]

    firmas_table = Table([[sig_cliente, sig_cobrador]], colWidths=[270, 270])
    firmas_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    firmas_elements = [firmas_table]
    if acta_cfg.get("pie_pagina"):
        firmas_elements.append(Spacer(1, 4))
        firmas_elements.append(Paragraph(f"<font size='6' color='#64748B'>{acta_cfg['pie_pagina']}</font>", style_signature_sub))
    story.append(KeepTogether(firmas_elements))

    doc.build(story, canvasmaker=ReciboNumberedCanvas)
    buffer.seek(0)
    pdf_bytes = buffer.getvalue()

    # Guardar copia física en el directorio de actas
    try:
        acta_path = os.path.join(ACTAS_DIR, f"{cid_clean}_acta.pdf")
        with open(acta_path, "wb") as f_out:
            f_out.write(pdf_bytes)
    except Exception as e:
        print(f"[PDF] Error guardando copia física del acta {cid_clean}:", e)

    return pdf_bytes


