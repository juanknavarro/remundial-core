import io
import json
import os
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.graphics.shapes import Drawing, Rect


def format_cop(valor: Any) -> str:
    """Formatea un número o Decimal a formato moneda COP estándar: $ 1.250.000."""
    try:
        num = float(valor or 0)
        formatted = f"{num:,.0f}".replace(",", ".")
        return f"$ {formatted}"
    except (ValueError, TypeError):
        return "$ 0"


def obtener_datos_empresa_reporte() -> Dict[str, str]:
    """Obtiene los parámetros institucionales configurados en el sistema (Razón Social, eslogan, datos comerciales)."""
    defaults = {
        "razon_social": "REMUNDIAL ARTE'S",
        "subtitulo": "Mueblería, Artesanías, Mecedoras & Cuadros por Encargo",
        "lema": "El arte a tu alcance con financiamiento transparente",
        "nit": "",
        "regimen": "",
        "ciudad": "Montería, Córdoba",
        "direccion": "",
        "telefono": "",
        "correo": "",
    }
    config_file = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "storage", "config_parametros.json")
    )
    if os.path.exists(config_file):
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                empresa = data.get("empresa", {})
                if empresa.get("razon_social"):
                    defaults["razon_social"] = str(empresa["razon_social"]).strip().upper()
                if "nit" in empresa and empresa["nit"] is not None:
                    defaults["nit"] = str(empresa["nit"]).strip()
                if empresa.get("ciudad_principal"):
                    defaults["ciudad"] = str(empresa["ciudad_principal"]).strip()
                if empresa.get("telefono_soporte"):
                    defaults["telefono"] = str(empresa["telefono_soporte"]).strip()
                if empresa.get("lema"):
                    defaults["lema"] = str(empresa["lema"]).strip()

                plantillas = data.get("plantillas_pdf", {})
                membrete = plantillas.get("membrete", {})
                if membrete.get("razon_social"):
                    defaults["razon_social"] = str(membrete["razon_social"]).strip().upper()
                if membrete.get("subtitulo"):
                    defaults["subtitulo"] = str(membrete["subtitulo"]).strip()
                if "nit" in membrete and membrete["nit"] is not None:
                    defaults["nit"] = str(membrete["nit"]).strip()
                if "regimen" in membrete and membrete["regimen"] is not None:
                    defaults["regimen"] = str(membrete["regimen"]).strip()
                if membrete.get("ciudad"):
                    defaults["ciudad"] = str(membrete["ciudad"]).strip()
                if membrete.get("direccion"):
                    defaults["direccion"] = str(membrete["direccion"]).strip()
                if membrete.get("telefono_pbx"):
                    defaults["telefono"] = str(membrete["telefono_pbx"]).strip()
                if membrete.get("correo"):
                    defaults["correo"] = str(membrete["correo"]).strip()
        except Exception as e:
            print(f"[PDF Reporte] Error cargando configuración de empresa: {e}")
    return defaults


def make_progress_drawing(
    pct: int,
    is_mora: bool = False,
    is_contado: bool = False,
    width: float = 65,
    height: float = 4,
) -> Drawing:
    """Genera una barra de progreso vectorial redondeada para ReportLab."""
    d = Drawing(width, height)
    # Pista de fondo
    bg_color = colors.HexColor("#DCFCE7") if is_contado else colors.HexColor("#F1F5F9")
    d.add(Rect(0, 0, width, height, fillColor=bg_color, strokeColor=None, rx=2, ry=2))
    # Relleno de progreso
    fill_w = max(0.0, min(float(width), float(width) * (pct / 100.0)))
    if fill_w > 0:
        bar_color = (
            colors.HexColor("#059669")
            if is_contado
            else (colors.HexColor("#E11D48") if is_mora else colors.HexColor("#0F172A"))
        )
        d.add(Rect(0, 0, fill_w, height, fillColor=bar_color, strokeColor=None, rx=2, ry=2))
    return d


class NumberedCanvas(canvas.Canvas):
    """Canvas de dos pasos para calcular el total exacto de páginas y estampar pie de página corporativo."""

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
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))  # Slate-500

        # Línea divisoria de pie de página
        self.setStrokeColor(colors.HexColor("#E2E8F0"))  # Slate-200
        self.setLineWidth(0.5)
        self.line(36, 30, 756, 30)

        # Textos de pie de página
        fecha_str = datetime.now().strftime("%d/%m/%Y %H:%M")
        footer_left = f"Remundial Core v2.0 • Plataforma Comercial & Cartera • Generado el {fecha_str}"
        footer_right = f"Página {self._pageNumber} de {page_count}"

        self.drawString(36, 18, footer_left)
        self.drawRightString(756, 18, footer_right)

        self.restoreState()


def generar_pdf_reporte_ventas(
    metricas: Dict[str, Any],
    operaciones: List[Dict[str, Any]],
    filtros: Dict[str, Any],
    usuario_auditor: Optional[str] = "Supervisor / Master",
) -> bytes:
    """Genera un reporte ejecutivo en PDF (formato Landscape Letter) con ReportLab."""
    buffer = io.BytesIO()

    # Documento en formato horizontal (Landscape Letter: 792 x 612 pt) con márgenes de 0.5 pulgada (36 pt)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(letter),
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=45,
    )

    styles = getSampleStyleSheet()

    # Estilos tipográficos personalizados
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#0F172A"),  # Slate-900
    )

    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#475569"),  # Slate-600
    )

    filter_label_style = ParagraphStyle(
        "FilterLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#1E293B"),
    )

    filter_val_style = ParagraphStyle(
        "FilterVal",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#475569"),
    )

    kpi_title_style = ParagraphStyle(
        "KpiTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        alignment=1,  # Centrado
        textColor=colors.HexColor("#475569"),
    )

    kpi_val_style = ParagraphStyle(
        "KpiValue",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        alignment=1,  # Centrado
        textColor=colors.HexColor("#0F172A"),
    )

    kpi_sub_style = ParagraphStyle(
        "KpiSub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9,
        alignment=1,
        textColor=colors.HexColor("#64748B"),
    )

    table_header_style = ParagraphStyle(
        "TableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.white,
    )

    table_cell_style = ParagraphStyle(
        "TableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#1E293B"),
    )

    table_cell_bold = ParagraphStyle(
        "TableCellBold",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#0F172A"),
    )

    table_header_right = ParagraphStyle(
        "TableHeaderRight",
        parent=table_header_style,
        alignment=2,  # Derecha
    )

    table_cell_right = ParagraphStyle(
        "TableCellRight",
        parent=table_cell_style,
        alignment=2,  # Derecha
    )

    table_cell_bold_right = ParagraphStyle(
        "TableCellBoldRight",
        parent=table_cell_bold,
        alignment=2,  # Derecha
    )

    table_cell_badge_credito = ParagraphStyle(
        "TableBadgeCredito",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8.5,
        alignment=1,
        textColor=colors.HexColor("#1E40AF"),  # Blue-800
    )

    table_cell_badge_contado = ParagraphStyle(
        "TableBadgeContado",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8.5,
        alignment=1,
        textColor=colors.HexColor("#065F46"),  # Emerald-800
    )

    elements = []

    # =========================================================================
    # 1. CABECERA INSTITUCIONAL Y BANNER DEL REPORTE
    # =========================================================================
    empresa = obtener_datos_empresa_reporte()

    # Construir bloque institucional izquierdo con textos dinámicos
    col_empresa = [f"<b>{empresa['razon_social']}</b>"]
    subtitulo_txt = empresa.get("subtitulo") or empresa.get("lema")
    if subtitulo_txt:
        col_empresa.append(f"<font size=7.5 color='#475569'>{subtitulo_txt}</font>")

    datos_comerciales = []
    if empresa.get("nit") and empresa["nit"].strip():
        datos_comerciales.append(f"NIT: {empresa['nit'].strip()}")
    if empresa.get("regimen") and empresa["regimen"].strip():
        datos_comerciales.append(empresa["regimen"].strip())
    if empresa.get("ciudad") and empresa["ciudad"].strip():
        datos_comerciales.append(empresa["ciudad"].strip())
    if empresa.get("telefono") and empresa["telefono"].strip():
        datos_comerciales.append(f"PBX: {empresa['telefono'].strip()}")

    if datos_comerciales:
        col_empresa.append(f"<font size=7 color='#64748B'>{' • '.join(datos_comerciales[:3])}</font>")

    empresa_p_content = "<br/>".join(col_empresa)

    header_data = [
        [
            Paragraph(empresa_p_content, subtitle_style),
            Paragraph("<b>REPORTE EJECUTIVO DE VENTAS Y CARTERA</b>", title_style),
            Paragraph(f"<b>Emisión:</b> {datetime.now().strftime('%d/%m/%Y')}<br/><b>Auditor:</b> {usuario_auditor}", subtitle_style),
        ]
    ]
    header_table = Table(header_data, colWidths=[240, 310, 170])
    header_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 0), (1, 0), "CENTER"),
            ("ALIGN", (2, 0), (2, 0), "RIGHT"),
        ])
    )
    elements.append(header_table)
    elements.append(Spacer(1, 8))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceAfter=8))

    # =========================================================================
    # 2. CUADRO DE FILTROS APLICADOS
    # =========================================================================
    f_inicio = filtros.get("fecha_inicio") or "Inicio de registros"
    f_fin = filtros.get("fecha_fin") or "Fecha actual"
    f_tipo = filtros.get("tipo_venta", "todos").capitalize()
    f_cliente = filtros.get("cliente_nombre") or "Todos los clientes"
    f_ciudad = filtros.get("ciudad_venta") or "Todas las Localidades"
    f_contrato = filtros.get("numero_contrato") or "Todos"

    filter_box_data = [
        [
            Paragraph("<b>Rango Fecha:</b>", filter_label_style),
            Paragraph(f"{f_inicio} al {f_fin}", filter_val_style),
            Paragraph("<b>Modalidad:</b>", filter_label_style),
            Paragraph(f"{f_tipo}", filter_val_style),
            Paragraph("<b>Localidad:</b>", filter_label_style),
            Paragraph(f"{f_ciudad}", filter_val_style),
            Paragraph("<b>Filtro Folio:</b>", filter_label_style),
            Paragraph(f"{f_contrato}", filter_val_style),
        ]
    ]
    filter_box = Table(filter_box_data, colWidths=[70, 130, 65, 80, 65, 110, 70, 130])
    filter_box.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ])
    )
    elements.append(filter_box)
    elements.append(Spacer(1, 10))

    # =========================================================================
    # 3. TARJETAS DE KPIS FINANCIEROS (RESUMEN EJECUTIVO)
    # =========================================================================
    total_vendido = metricas.get("total_vendido", 0)
    vol_credito = metricas.get("volumen_credito", 0)
    vol_contado = metricas.get("volumen_contado", 0)
    ticket_prom = metricas.get("ticket_promedio", 0)
    total_ops = metricas.get("total_operaciones", 0)
    ops_cred = metricas.get("operaciones_credito", 0)
    ops_cont = metricas.get("operaciones_contado", 0)

    pct_cred = f"{(vol_credito / total_vendido * 100):.1f}%" if total_vendido > 0 else "0%"
    pct_cont = f"{(vol_contado / total_vendido * 100):.1f}%" if total_vendido > 0 else "0%"

    kpi_data = [
        [
            # Tarjeta 1: Total Facturado
            [
                Paragraph("TOTAL FACTURADO", kpi_title_style),
                Spacer(1, 2),
                Paragraph(format_cop(total_vendido), kpi_val_style),
                Spacer(1, 1),
                Paragraph(f"{total_ops} ventas procesadas", kpi_sub_style),
            ],
            # Tarjeta 2: Colocación a Crédito
            [
                Paragraph("VENTAS A CRÉDITO", kpi_title_style),
                Spacer(1, 2),
                Paragraph(format_cop(vol_credito), kpi_val_style),
                Spacer(1, 1),
                Paragraph(f"{ops_cred} contratos ({pct_cred} del total)", kpi_sub_style),
            ],
            # Tarjeta 3: Ventas de Contado
            [
                Paragraph("VENTAS DE CONTADO", kpi_title_style),
                Spacer(1, 2),
                Paragraph(format_cop(vol_contado), kpi_val_style),
                Spacer(1, 1),
                Paragraph(f"{ops_cont} transacciones ({pct_cont} del total)", kpi_sub_style),
            ],
            # Tarjeta 4: Ticket Promedio
            [
                Paragraph("TICKET PROMEDIO", kpi_title_style),
                Spacer(1, 2),
                Paragraph(format_cop(ticket_prom), kpi_val_style),
                Spacer(1, 1),
                Paragraph("Promedio por operación", kpi_sub_style),
            ],
        ]
    ]

    kpi_table = Table(kpi_data, colWidths=[180, 180, 180, 180])
    kpi_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#F1F5F9")),
            ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#EFF6FF")),  # Azul suave
            ("BACKGROUND", (2, 0), (2, 0), colors.HexColor("#ECFDF5")),  # Verde suave
            ("BACKGROUND", (3, 0), (3, 0), colors.HexColor("#F8FAFC")),
            ("BOX", (0, 0), (0, 0), 0.5, colors.HexColor("#CBD5E1")),
            ("BOX", (1, 0), (1, 0), 0.5, colors.HexColor("#BFDBFE")),
            ("BOX", (2, 0), (2, 0), 0.5, colors.HexColor("#A7F3D0")),
            ("BOX", (3, 0), (3, 0), 0.5, colors.HexColor("#CBD5E1")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ])
    )
    elements.append(kpi_table)
    elements.append(Spacer(1, 14))

    # =========================================================================
    # 4. TABLA DETALLADA DE OPERACIONES AUDITADAS
    # =========================================================================
    elements.append(
        Paragraph(
            f"<b>DESGLOSE DE OPERACIONES AUDITADAS ({len(operaciones)} registros)</b>",
            filter_label_style,
        )
    )
    elements.append(Spacer(1, 4))

    # Total ancho = 720 pt (Landscape letter con márgenes de 36 pt)
    col_widths = [60, 50, 115, 50, 65, 115, 90, 90, 85]

    table_rows = [
        [
            Paragraph("Contrato", table_header_style),
            Paragraph("Fecha", table_header_style),
            Paragraph("Cliente & Cédula", table_header_style),
            Paragraph("Modalidad", table_header_style),
            Paragraph("Vendedor", table_header_style),
            Paragraph("Artículos Vendidos", table_header_style),
            Paragraph("Monto Total", table_header_right),
            Paragraph("Saldo Pendiente", table_header_right),
            Paragraph("Progreso", table_header_style),
        ]
    ]

    if not operaciones:
        empty_row = [
            Paragraph("No se encontraron operaciones registradas en el período seleccionado.", table_cell_style)
        ] + [Paragraph("", table_cell_style)] * 8
        table_rows.append(empty_row)
    else:
        for op in operaciones:
            contrato_str = op.get("codigo_contrato") or f"CTR-{str(op.get('id_contrato', ''))[:8].upper()}"
            fecha_val = op.get("fecha")
            if isinstance(fecha_val, datetime):
                fecha_str = fecha_val.strftime("%d/%m/%Y")
            elif isinstance(fecha_val, str) and len(fecha_val) >= 10:
                fecha_str = fecha_val[:10]
            else:
                fecha_str = "Reciente"

            cliente_info = f"<b>{op.get('cliente_nombre', 'Cliente')}</b><br/><font size=6.5 color='#64748B'>CC: {op.get('cliente_cedula', 'S/N')}</font>"
            es_contado = op.get("tipo_venta") == "contado"
            modalidad_text = "<b>CONTADO</b>" if es_contado else f"<b>CRÉDITO</b><br/><font size=6.5 color='#475569'>{op.get('numero_cuotas', 1)} cuotas</font>"
            badge_style = table_cell_badge_contado if es_contado else table_cell_badge_credito

            # Cálculo financiero de progreso del crédito (Porcentaje y cuotas amortizadas)
            monto_total = float(op.get("monto_total") or 0)
            saldo_pend = float(op.get("saldo_pendiente") or 0)
            monto_fin = float(op.get("monto_financiado") or 0)
            num_cuotas = int(op.get("numero_cuotas") or 1)
            val_cuota = float(op.get("valor_cuota") or 0)
            estado_op = str(op.get("estado") or "activo").lower()

            if es_contado:
                prog_text = Paragraph("<font size=6.5 color='#047857'><b>100% Pagado</b></font>", table_cell_style)
                prog_bar = make_progress_drawing(pct=100, is_contado=True, width=75, height=4)
            else:
                pct_pago = round(((monto_total - saldo_pend) / monto_total) * 100) if monto_total > 0 else 0
                pct_pago = max(0, min(100, pct_pago))
                cuotas_pagas = 0
                if val_cuota > 0:
                    amortizado = max(0.0, monto_fin - saldo_pend)
                    cuotas_pagas = min(num_cuotas, round(amortizado / val_cuota))
                prog_text = Paragraph(
                    f"<font size=6.5 color='#334155'><b>{cuotas_pagas}/{num_cuotas}</b> ({pct_pago}%)</font>",
                    table_cell_style,
                )
                prog_bar = make_progress_drawing(
                    pct=pct_pago,
                    is_mora=(estado_op == "mora"),
                    is_contado=False,
                    width=75,
                    height=4,
                )

            prog_cell = [prog_text, Spacer(1, 2), prog_bar]

            articulos_txt = op.get("articulos_resumen") or "Artículos del catálogo"
            monto_str = format_cop(op.get("monto_total", 0))
            saldo_str = format_cop(op.get("saldo_pendiente", 0))

            contrato_str = op.get("codigo_contrato") or f"CTR-{str(op.get('id_contrato', ''))[:8].upper()}"
            ciu_str = op.get("ciudad_venta") or "Montería"
            table_rows.append([
                Paragraph(f"<b>{contrato_str}</b><br/><font color='#64748B' size='6'>{ciu_str}</font>", table_cell_bold),
                Paragraph(fecha_str, table_cell_style),
                Paragraph(cliente_info, table_cell_style),
                Paragraph(modalidad_text, badge_style),
                Paragraph(op.get("vendedor_nombre", "Vendedor"), table_cell_style),
                Paragraph(articulos_txt, table_cell_style),
                Paragraph(f"<b>{monto_str}</b>", table_cell_bold_right),
                Paragraph(f"<b>{saldo_str}</b>", table_cell_bold_right) if saldo_pend > 0 else Paragraph(saldo_str, table_cell_right),
                prog_cell,
            ])

    ops_table = Table(table_rows, colWidths=col_widths, repeatRows=1)
    
    table_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),  # Header Slate-900
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (5, -1), "LEFT"),
        ("ALIGN", (6, 0), (7, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
    ]

    # Alternar color de filas
    for i in range(1, len(table_rows)):
        if i % 2 == 0:
            table_styles.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8FAFC")))

    if not operaciones:
        table_styles.append(("SPAN", (0, 1), (-1, 1)))
        table_styles.append(("ALIGN", (0, 1), (-1, 1), "CENTER"))

    ops_table.setStyle(TableStyle(table_styles))
    elements.append(ops_table)

    # Construir el documento con NumberedCanvas
    doc.build(elements, canvasmaker=NumberedCanvas)

    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def generar_pdf_reporte_cartera(
    metricas: Dict[str, Any],
    creditos: List[Dict[str, Any]],
    filtros: Dict[str, Any],
    usuario_auditor: Optional[str] = "Supervisor / Auditor",
) -> bytes:
    """Genera un reporte ejecutivo de cartera y plan de cuotas en PDF (formato Landscape Letter) con ReportLab,
    incluyendo marcas visuales de verificación ('chulos' verdes) para cuotas recaudadas."""
    buffer = io.BytesIO()

    # Formato horizontal (Landscape Letter: 792 x 612 pt) con márgenes de 36 pt (0.5 pulgada)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(letter),
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=45,
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "DocTitleC",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=17,
        leading=21,
        textColor=colors.HexColor("#0F172A"),
    )

    subtitle_style = ParagraphStyle(
        "DocSubtitleC",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#475569"),
    )

    kpi_title_style = ParagraphStyle(
        "KpiTitleC",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        alignment=1,
        textColor=colors.HexColor("#475569"),
    )

    kpi_val_style = ParagraphStyle(
        "KpiValueC",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        alignment=1,
        textColor=colors.HexColor("#0F172A"),
    )

    kpi_sub_style = ParagraphStyle(
        "KpiSubC",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=9,
        alignment=1,
        textColor=colors.HexColor("#64748B"),
    )

    table_header_style = ParagraphStyle(
        "TableHeaderC",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.white,
    )

    table_cell_style = ParagraphStyle(
        "TableCellC",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#1E293B"),
    )

    table_cell_bold = ParagraphStyle(
        "TableCellBoldC",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#0F172A"),
    )

    table_cell_right = ParagraphStyle(
        "TableCellRightC",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        alignment=2,
        textColor=colors.HexColor("#1E293B"),
    )

    table_cell_bold_right = ParagraphStyle(
        "TableCellBoldRightC",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        alignment=2,
        textColor=colors.HexColor("#0F172A"),
    )

    cuota_pagada_style = ParagraphStyle(
        "CuotaPagadaC",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#047857"),
    )

    cuota_pendiente_style = ParagraphStyle(
        "CuotaPendienteC",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#B45309"),
    )

    elements = []

    # 1. ENCABEZADO CORPORATIVO
    fecha_emision_str = datetime.now().strftime("%d/%m/%Y %H:%M")
    empresa = obtener_datos_empresa_reporte()

    subtitulo_emp = empresa.get("subtitulo") or empresa.get("lema") or "Plataforma Central de Crédito & Cartera"

    comercial_parts = []
    if empresa.get("nit") and empresa["nit"].strip():
        comercial_parts.append(f"NIT: {empresa['nit'].strip()}")
    if empresa.get("regimen") and empresa["regimen"].strip():
        comercial_parts.append(empresa["regimen"].strip())
    if empresa.get("ciudad") and empresa["ciudad"].strip():
        comercial_parts.append(empresa["ciudad"].strip())
    if empresa.get("telefono") and empresa["telefono"].strip():
        comercial_parts.append(f"PBX: {empresa['telefono'].strip()}")

    emp_header_text = f"<b>{empresa['razon_social']}</b>"
    if subtitulo_emp:
        emp_header_text += f" • <font color='#475569'>{subtitulo_emp}</font>"

    header_left = [
        Paragraph(
            emp_header_text,
            ParagraphStyle(
                "CompanyHeaderC",
                fontName="Helvetica-Bold",
                fontSize=8.5,
                textColor=colors.HexColor("#059669"),
                leading=11,
            ),
        ),
    ]

    if comercial_parts:
        header_left.append(
            Paragraph(
                " • ".join(comercial_parts[:3]),
                ParagraphStyle(
                    "CompanySubC",
                    fontName="Helvetica",
                    fontSize=7.5,
                    textColor=colors.HexColor("#64748B"),
                    leading=10,
                ),
            )
        )

    header_left.extend([
        Spacer(1, 2),
        Paragraph("Informe de Cartera & Plan de Cuotas", title_style),
        Paragraph("Auditoría de cuotas recaudadas con marca de verificación y saldos pendientes", subtitle_style),
    ])

    cobrador_str = filtros.get("cobrador_nombre") or "Todos los Cobradores"
    periodo_str = filtros.get("periodo_texto") or "Jornada Completa"
    fecha_rango = f"{filtros.get('fecha_inicio', '')} al {filtros.get('fecha_fin', '')}".strip(" al ")
    ciudad_str = filtros.get("ciudad_venta") or "Todas las Localidades"
    contrato_str = filtros.get("numero_contrato")

    header_right = [
        Paragraph(f"<b>Supervisor Auditor:</b> {usuario_auditor}", table_cell_style),
        Paragraph(f"<b>Cobrador / Ruta:</b> {cobrador_str}", table_cell_style),
        Paragraph(f"<b>Localidad Geográfica:</b> {ciudad_str}" + (f" • <b>Folio:</b> {contrato_str}" if contrato_str else ""), table_cell_style),
        Paragraph(f"<b>Periodo:</b> {periodo_str} {('(' + fecha_rango + ')') if fecha_rango else ''}", table_cell_style),
        Paragraph(f"<b>Emisión:</b> {fecha_emision_str}", table_cell_style),
    ]

    header_table = Table([[header_left, header_right]], colWidths=[420, 300])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 10))

    # 2. BLOQUE DE TARJETAS KPI (4 MÉTRICAS FINANCIERAS)
    t_cartera = format_cop(metricas.get("total_cartera", 0))
    t_saldo = format_cop(metricas.get("saldo_total_pendiente", 0))
    t_recaudado = format_cop(metricas.get("total_recaudado", 0))
    c_pagadas = metricas.get("cuotas_pagadas", 0)
    c_totales = metricas.get("cuotas_totales", 0)
    pct_cumplimiento = int(round((c_pagadas / c_totales) * 100)) if c_totales > 0 else 0

    kpi_card_1 = [
        Paragraph("TOTAL CARTERA FINANCIADA", kpi_title_style),
        Paragraph(t_cartera, kpi_val_style),
        Paragraph(f"{metricas.get('total_creditos', 0)} contratos registrados", kpi_sub_style),
    ]
    kpi_card_2 = [
        Paragraph("TOTAL AMORTIZADO / RECAUDADO", kpi_title_style),
        Paragraph(f"<font color='#059669'>{t_recaudado}</font>", kpi_val_style),
        Paragraph(f"{c_pagadas} cuotas cobradas", kpi_sub_style),
    ]
    kpi_card_3 = [
        Paragraph("SALDO TOTAL POR COBRAR", kpi_title_style),
        Paragraph(f"<font color='#E11D48'>{t_saldo}</font>", kpi_val_style),
        Paragraph(f"{metricas.get('cuotas_pendientes', 0)} cuotas pendientes", kpi_sub_style),
    ]
    kpi_card_4 = [
        Paragraph("CUMPLIMIENTO DE CUOTAS", kpi_title_style),
        Paragraph(f"{pct_cumplimiento}%", kpi_val_style),
        Paragraph(f"{c_pagadas} de {c_totales} cuotas con chulo", kpi_sub_style),
    ]

    kpi_table = Table([[kpi_card_1, kpi_card_2, kpi_card_3, kpi_card_4]], colWidths=[174, 174, 174, 174])
    kpi_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(kpi_table)
    elements.append(Spacer(1, 10))

    # 3. TABLA PRINCIPAL DE CRÉDITOS Y DESGLOSE DE CUOTAS CON MARCA DE VERIFICACIÓN
    col_widths = [75, 115, 80, 65, 65, 320]
    table_headers = [
        Paragraph("<b>CONTRATO</b>", table_header_style),
        Paragraph("<b>CLIENTE TITULAR</b>", table_header_style),
        Paragraph("<b>COBRADOR / RUTA</b>", table_header_style),
        Paragraph("<b>FINANCIADO</b>", ParagraphStyle("HFinC", parent=table_header_style, alignment=2)),
        Paragraph("<b>SALDO PEND.</b>", ParagraphStyle("HSaldC", parent=table_header_style, alignment=2)),
        Paragraph("<b>PLAN DE CUOTAS (MARCA DE VERIFICACIÓN DE RECAUDO)</b>", table_header_style),
    ]

    table_rows = [table_headers]

    if not creditos:
        empty_msg = Paragraph("No se encontraron contratos de cartera que coincidan con los filtros seleccionados.", subtitle_style)
        table_rows.append([empty_msg, "", "", "", "", ""])
    else:
        for c in creditos:
            contrato_code = c.get("codigo_contrato") or f"CTR-{str(c.get('id_contrato', ''))[:8].upper()}"
            f_inicio = str(c.get("fecha_inicio") or "")[:10]
            ciu_cartera = c.get("ciudad_venta") or "Montería"
            contrato_cell = f"<b>{contrato_code}</b><br/><font color='#64748B' size='6.5'>{f_inicio} • {ciu_cartera}</font>"

            cliente_nom = c.get("cliente_nombre") or "Cliente Titular"
            cliente_ced = c.get("cliente_cedula") or ""
            cliente_tel = c.get("cliente_telefono") or ""
            cliente_cell = f"<b>{cliente_nom}</b>"
            if cliente_ced:
                cliente_cell += f"<br/><font color='#64748B' size='6.5'>CC: {cliente_ced}</font>"
            if cliente_tel:
                cliente_cell += f"<br/><font color='#64748B' size='6.5'>Tel: {cliente_tel}</font>"

            cobrador_txt = c.get("cobrador_nombre") or "Sin asignar"
            frecuencia = str(c.get("tipo_pago") or "mensual").capitalize()
            cobrador_cell = f"{cobrador_txt}<br/><font color='#64748B' size='6.5'>{frecuencia}</font>"

            m_fin = format_cop(c.get("monto_financiado", 0))
            s_pen = format_cop(c.get("saldo_pendiente", 0))
            saldo_num = float(c.get("saldo_pendiente", 0))

            # Generar desglose de cuotas con marca de verificación
            cronograma = c.get("cronograma") or []
            cuota_parts = []
            for cuota in cronograma:
                num = cuota.get("numero", 1)
                val_c = format_cop(cuota.get("valor_cuota", 0))
                f_venc = str(cuota.get("fecha_vencimiento") or "")[5:]  # MM-DD
                is_pagada = cuota.get("pagada", False)

                if is_pagada:
                    # Chulo verde de completado
                    cuota_parts.append(
                        f"<font color='#047857'><b>[&#10004; C{num}: {val_c} Pagada]</b></font>"
                    )
                else:
                    # Pendiente / por vencer
                    cuota_parts.append(
                        f"<font color='#475569'>[&#9675; C{num}: {val_c} Vence {f_venc}]</font>"
                    )

            cuotas_cell = "  ".join(cuota_parts) if cuota_parts else "<font color='#94A3B8'>Sin cronograma</font>"

            table_rows.append([
                Paragraph(contrato_cell, table_cell_style),
                Paragraph(cliente_cell, table_cell_style),
                Paragraph(cobrador_cell, table_cell_style),
                Paragraph(m_fin, table_cell_bold_right),
                Paragraph(f"<font color='#E11D48'><b>{s_pen}</b></font>", table_cell_bold_right) if saldo_num > 0 else Paragraph(s_pen, table_cell_right),
                Paragraph(cuotas_cell, table_cell_style),
            ])

    cartera_table = Table(table_rows, colWidths=col_widths, repeatRows=1)
    t_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),  # Slate-900 Header
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (2, -1), "LEFT"),
        ("ALIGN", (3, 0), (4, -1), "RIGHT"),
        ("ALIGN", (5, 0), (5, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
    ]

    for i in range(1, len(table_rows)):
        if i % 2 == 0:
            t_styles.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8FAFC")))

    if not creditos:
        t_styles.append(("SPAN", (0, 1), (-1, 1)))
        t_styles.append(("ALIGN", (0, 1), (-1, 1), "CENTER"))

    cartera_table.setStyle(TableStyle(t_styles))
    elements.append(cartera_table)

    # 4. SECCIÓN DE FIRMAS DE AUDITORÍA
    elements.append(Spacer(1, 16))
    firma_supervisor = [
        Spacer(1, 20),
        HRFlowable(width="80%", thickness=0.5, color=colors.HexColor("#94A3B8"), spaceBefore=0, spaceAfter=4),
        Paragraph(f"<b>{usuario_auditor}</b>", table_cell_bold),
        Paragraph("Firma Supervisor / Auditor de Cartera", kpi_sub_style),
    ]
    firma_cobrador = [
        Spacer(1, 20),
        HRFlowable(width="80%", thickness=0.5, color=colors.HexColor("#94A3B8"), spaceBefore=0, spaceAfter=4),
        Paragraph(f"<b>{cobrador_str}</b>", table_cell_bold),
        Paragraph("Firma Cobrador de Ruta Responsable", kpi_sub_style),
    ]

    firmas_table = Table([[firma_supervisor, firma_cobrador]], colWidths=[360, 360])
    firmas_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 20),
        ("RIGHTPADDING", (0, 0), (-1, -1), 20),
    ]))
    elements.append(firmas_table)

    # Construir PDF con NumberedCanvas
    doc.build(elements, canvasmaker=NumberedCanvas)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes

