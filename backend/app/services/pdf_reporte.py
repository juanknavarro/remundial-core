import io
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
    header_data = [
        [
            Paragraph("<b>REMUNDIAL CORE</b><br/><font size=8 color='#64748B'>Muebles Artesanales & Galerías del Caribe</font>", subtitle_style),
            Paragraph("<b>REPORTE EJECUTIVO DE VENTAS Y CARTERA</b>", title_style),
            Paragraph(f"<b>Emisión:</b> {datetime.now().strftime('%d/%m/%Y')}<br/><b>Auditor:</b> {usuario_auditor}", subtitle_style),
        ]
    ]
    header_table = Table(header_data, colWidths=[200, 340, 180])
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

    filter_box_data = [
        [
            Paragraph("<b>Rango de Fecha:</b>", filter_label_style),
            Paragraph(f"{f_inicio}  al  {f_fin}", filter_val_style),
            Paragraph("<b>Modalidad de Venta:</b>", filter_label_style),
            Paragraph(f"{f_tipo}", filter_val_style),
            Paragraph("<b>Filtro Cliente:</b>", filter_label_style),
            Paragraph(f"{f_cliente}", filter_val_style),
        ]
    ]
    filter_box = Table(filter_box_data, colWidths=[80, 160, 100, 120, 80, 180])
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

            table_rows.append([
                Paragraph(f"<b>{contrato_str}</b>", table_cell_bold),
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
