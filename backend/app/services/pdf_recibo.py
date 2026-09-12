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

from app.models.credito import Credito, TipoPago
from app.schemas.credito import generar_cronograma_con_arrastre

# Directorio local seguro para archivo inmutable de firmas digitales
FIRMAS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "storage", "firmas"))
os.makedirs(FIRMAS_DIR, exist_ok=True)


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
) -> None:
    """Almacena las firmas en formato base64 PNG en el sistema de archivos local para trazabilidad inmutable."""
    if not id_contrato:
        return
    cid = str(id_contrato).strip().lower()
    firmas = {
        "titular": firma_titular,
        "vendedor": firma_vendedor,
        "codeudor": firma_codeudor,
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


def obtener_timestamp_local_servidor(dt: Optional[datetime] = None) -> datetime:
    """Retorna el timestamp local real del servidor al momento de la orden, evitando desfases de zona horaria (UTC)."""
    if dt is None:
        return datetime.now().astimezone()
    return dt.astimezone()


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
        fecha_str = self.fecha_impresion or obtener_timestamp_local_servidor().strftime("%d/%m/%Y %I:%M %p")
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
    codigo_ctr = f"CTR-{str(credito.id_contrato)[:8].upper()}"
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

    # 2. ENCABEZADO OFICIAL DE REMUNDIAL ARTE'S
    # Columna Izquierda: Logo y Razón Social • Columna Derecha: Recuadro Oficial de Comprobante
    header_col_izq = [
        Paragraph("REMUNDIAL ARTE'S", style_title),
        Spacer(1, 2),
        Paragraph(
            "<b>Mueblería, Artesanías, Mecedoras & Cuadros por Encargo</b><br/>"
            "NIT: 901.458.321-0 • Régimen Comercial Colombiano<br/>"
            "Montería - Córdoba • Carrera 5 # 31-20, Centro<br/>"
            "PBX / Ventas: (+57) 300 123 4567 • info@remundialartes.com",
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

    # 7. CLÁUSULAS CONTRACTUALES GENERALES RESUMIDAS (DEL TALONARIO FÍSICO)
    clausulas_texto = (
        "<b>CLÁUSULAS GENERALES DE COMPRAVENTA Y FINANCIACIÓN:</b><br/>"
        "<b>1. Objeto y Recepción:</b> El CLIENTE adquiere a entera satisfacción los artículos y muebles descritos en este comprobante. "
        "<b>2. Cuadros al Óleo y Por Encargo:</b> Las obras artísticas por encargo se elaboran a mano con especificaciones acordadas; "
        "una vez iniciada la producción artística no se admiten cancelaciones ni retractos unilaterales. "
        "<b>3. Plan de Pagos Mensual:</b> Las cuotas pactadas vencen puntualmente el último día calendario de cada mes respectivo. "
        "Los abonos parciales reducen el saldo, y cualquier diferencia insoluta se arrastra a la siguiente exigibilidad sin alterar el plazo. "
        "<b>4. Reserva de Dominio y Mérito Ejecutivo:</b> Remundial Arte's conserva la propiedad de los bienes hasta el pago total de la obligación. "
        "El presente documento presta mérito ejecutivo de conformidad con la legislación mercantil colombiana."
    )

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
    firma_titular_b64 = getattr(credito, "firma_titular", None) or obtener_firma_almacenada(credito.id_contrato, "titular")
    firma_vendedor_b64 = getattr(credito, "firma_vendedor", None) or obtener_firma_almacenada(credito.id_contrato, "vendedor")
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
    sig_remundial = [
        crear_bloque_firma_imagen(firma_vendedor_b64, fallback_height=24),
        HRFlowable(width="85%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph("<b>POR REMUNDIAL ARTE'S</b><br/>Montería - Córdoba", style_signature_label),
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


def generar_pdf_recibo_abono(abono: Any, cobrador_nombre: Optional[str] = None) -> bytes:
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
    dt_abono = getattr(abono, "fecha", None) or getattr(abono, "creado_en", None) or datetime.now()
    dt_local = obtener_timestamp_local_servidor(dt_abono)
    fecha_abono_str = dt_local.strftime("%d/%m/%Y %I:%M %p")
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
    if c_nom_raw and str(c_nom_raw).strip().lower() not in ["cobrador", "none", "null", ""]:
        cobrador_nombre = str(c_nom_raw).strip()
    else:
        cobrador_nombre = "Cobrador Autorizado"
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

    # 3. ENCABEZADO OFICIAL
    header_col_izq = [
        Paragraph("REMUNDIAL ARTE'S", style_title),
        Spacer(1, 2),
        Paragraph(
            "<b>Mueblería, Artesanías, Mecedoras & Cuadros por Encargo</b><br/>"
            "NIT: 901.458.321-0 • Régimen Comercial Colombiano<br/>"
            "Montería - Córdoba • Carrera 5 # 31-20, Centro<br/>"
            "PBX / Cobranzas: (+57) 300 123 4567 • cobranzas@remundialartes.com",
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

    # 6. DECLARACIÓN DE VALIDEZ LEGAL
    legal_text = (
        "<b>CERTIFICACIÓN DE PAGO:</b> Este recibo digital certifica formalmente la recepción y registro del recaudo "
        "en las cuentas de Remundial Arte's. La presente constancia amortiza el saldo del contrato especificado y queda "
        "asentada de manera inmutable en los libros auxiliares de cartera. Conserve este comprobante para cualquier conciliación contable."
    )
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
    firma_cobrador_b64 = getattr(abono, "firma_cobrador", None) or obtener_firma_almacenada(abono.id_recibo, "cobrador")
    firma_cliente_b64 = (
        getattr(abono, "firma_cliente", None)
        or obtener_firma_almacenada(abono.id_recibo, "cliente")
        or (obtener_firma_almacenada(abono.credito_id, "titular") if getattr(abono, "credito_id", None) else None)
    )

    sig_cobrador = [
        crear_bloque_firma_imagen(firma_cobrador_b64, fallback_height=24),
        HRFlowable(width="80%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph(f"<b>COBRADOR AUTORIZADO EN RUTA</b><br/>{cobrador_nombre}", style_signature_label),
        Paragraph("Remundial Arte's • Montería", style_signature_sub),
        Paragraph("<font size='5.5' color='#64748B'>Firma y Sello de Recaudo Oficial</font>", style_signature_sub),
    ]

    sig_cliente = [
        crear_bloque_firma_imagen(firma_cliente_b64, fallback_height=24),
        HRFlowable(width="80%", thickness=0.75, color=c_primary, spaceBefore=0, spaceAfter=3),
        Paragraph(f"<b>CLIENTE / DEUDOR TITULAR</b><br/>{cliente_nombre}", style_signature_label),
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

