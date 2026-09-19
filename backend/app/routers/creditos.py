import json
import os
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    get_current_user,
    get_user_from_header_or_query,
    require_supervisor,
    require_vendedor_o_supervisor,
)
from app.core.security import decode_access_token
from app.crud import crud_credito
from app.models.credito import EstadoCredito, TipoPago
from app.models.usuario import RolUsuario, Usuario
from app.schemas.credito import (
    ArticuloRetiradoItem,
    CreditoCreate,
    CreditoResponse,
    CreditoUpdate,
    DiligenciaRetiroItem,
    OrdenRetiroRequest,
    OrdenRetiroResponse,
    ReingresoStockRequest,
    ReingresoStockResponse,
    generar_cronograma_con_arrastre,
)
from app.services.pdf_recibo import (
    ACTAS_DIR,
    FIRMAS_DIR,
    construir_nombre_archivo_pdf,
    generar_pdf_acta_restitucion,
    generar_pdf_recibo_venta,
    guardar_firmas_acta,
    guardar_firmas_contrato,
    obtener_timestamp_local_servidor,
)

router = APIRouter(
    prefix="/creditos",
    tags=["Créditos"],
)


@router.post(
    "",
    response_model=CreditoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Originar un nuevo crédito con artículos asociados (Solo Vendedor o Supervisor)",
)
async def originar_credito(
    credito_in: CreditoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_vendedor_o_supervisor),
):
    """Crea un nuevo contrato de crédito y sus líneas de detalle de forma transaccional.
    
    Seguridad RBAC: Solo accesible para roles 'vendedor' y 'supervisor'.
    """
    # Resolver vendedor: si es vendedor se asigna a sí mismo; si no se envió vendedor_id, toma el usuario en sesión
    if current_user.rol == RolUsuario.VENDEDOR or not credito_in.vendedor_id:
        credito_in.vendedor_id = current_user.id

    # Los créditos deben nacer limpios de ruta y cobrador (asignación posterior desde Cartera/Supervisión)
    credito_in.cobrador_id = None

    return await crud_credito.create_credito(db=db, credito_in=credito_in)


@router.get(
    "/cartera-critica",
    response_model=List[CreditoResponse],
    summary="Listar créditos en Cartera Crítica (3 o más cuotas vencidas, excluyendo plazos de 2 cuotas)",
    status_code=status.HTTP_200_OK,
)
async def listar_cartera_critica(
    skip: int = Query(0, ge=0, description="Registros a omitir para paginación"),
    limit: int = Query(100, ge=1, le=500, description="Límite de registros a retornar"),
    cobrador_id: Optional[UUID] = Query(None, description="Filtrar por cobrador asignado"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Consulta especializada para listar créditos en mora crítica (>= 3 cuotas vencidas y plazo total > 2)."""
    return await crud_credito.get_creditos(
        db=db,
        skip=skip,
        limit=limit,
        cobrador_id=cobrador_id,
        solo_cartera_critica=True,
    )


@router.get(
    "/articulos-retirados",
    response_model=List[DiligenciaRetiroItem],
    summary="Listar historial de artículos retirados y actas de restitución",
    status_code=status.HTTP_200_OK,
)
async def listar_articulos_retirados(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Consulta el historial consolidado de todas las órdenes de retiro y bienes restituidos."""
    contrato_ids_set = set()
    if os.path.exists(ACTAS_DIR):
        for fname in os.listdir(ACTAS_DIR):
            if fname.endswith("_acta.pdf") or fname.endswith("_metadata.json"):
                parts = fname.split("_")
                if len(parts) >= 2 and len(parts[0]) >= 8:
                    contrato_ids_set.add(parts[0].lower())

    if os.path.exists(FIRMAS_DIR):
        for fname in os.listdir(FIRMAS_DIR):
            if fname.endswith("_acta_cliente.png") or fname.endswith("_acta_cobrador.png"):
                parts = fname.split("_")
                if len(parts) >= 2 and len(parts[0]) >= 8:
                    contrato_ids_set.add(parts[0].lower())

    diligencias: List[DiligenciaRetiroItem] = []
    for cid_str in contrato_ids_set:
        try:
            credito = await crud_credito.get_credito_por_id_o_hash(db=db, id_o_hash=cid_str)
        except Exception:
            credito = None
        if not credito:
            continue

        meta_path = os.path.join(ACTAS_DIR, f"{cid_str}_metadata.json")
        meta_data = {}
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta_data = json.load(f)
            except Exception:
                meta_data = {}

        articulos_res: List[ArticuloRetiradoItem] = []
        if meta_data.get("articulos"):
            for a in meta_data["articulos"]:
                articulos_res.append(ArticuloRetiradoItem(**a))
        elif credito.detalles:
            for d in credito.detalles:
                articulos_res.append(
                    ArticuloRetiradoItem(
                        producto_id=str(d.producto_id),
                        nombre=getattr(d.producto, "nombre", None) or d.descripcion or "Artículo de catálogo",
                        sku=getattr(d.producto, "sku", None),
                        cantidad=d.cantidad or 1,
                        reingresado=False,
                    )
                )

        cobrador_nom = (
            meta_data.get("cobrador_nombre")
            or (getattr(credito.cobrador, "nombre_completo", None) if credito.cobrador else None)
            or (getattr(credito.cobrador, "nombre", None) if credito.cobrador else None)
            or "Gestor de Cobro en Ruta"
        )
        fecha_acta_str = meta_data.get("fecha_acta")
        if not fecha_acta_str:
            acta_f_path = os.path.join(ACTAS_DIR, f"{cid_str}_acta.pdf")
            if os.path.exists(acta_f_path):
                mtime = os.path.getmtime(acta_f_path)
                fecha_acta_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
            else:
                fecha_acta_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        total_art = sum(a.cantidad for a in articulos_res) or len(articulos_res)
        reingresados_count = sum(a.cantidad for a in articulos_res if a.reingresado)
        todos_reing = bool(articulos_res and all(a.reingresado for a in articulos_res))

        cliente_nom = (
            getattr(credito.cliente, "nombre_completo", None)
            or getattr(credito.cliente, "nombres", "Cliente Titular")
            if credito.cliente
            else "Cliente Titular"
        )
        cliente_doc = (
            getattr(credito.cliente, "documento_numero", None)
            or getattr(credito.cliente, "cedula", "S/N")
            if credito.cliente
            else "S/N"
        )
        cliente_tel = getattr(credito.cliente, "telefono", None) if credito.cliente else None
        cliente_dir = (
            f"{credito.cliente.direccion}{f' - {credito.cliente.barrio}' if credito.cliente.barrio else ''}"
            if credito.cliente and credito.cliente.direccion
            else None
        )

        diligencias.append(
            DiligenciaRetiroItem(
                id_contrato=credito.id_contrato,
                codigo_contrato=f"CTR-{str(credito.id_contrato)[:8].upper()}",
                cliente_nombre=cliente_nom,
                cliente_cedula=cliente_doc,
                cliente_telefono=cliente_tel,
                cliente_direccion=cliente_dir,
                cobrador_nombre=cobrador_nom,
                fecha_acta=fecha_acta_str,
                motivo=meta_data.get("motivo", "Mora crítica de 3 o más cuotas"),
                observaciones=meta_data.get("observaciones"),
                cuotas_vencidas=meta_data.get("cuotas_vencidas", 3),
                saldo_pendiente=credito.saldo_pendiente or Decimal("0.00"),
                pdf_url=f"/creditos/{credito.id_contrato}/acta-pdf",
                articulos=articulos_res,
                tiene_firmas=True,
                total_articulos=total_art,
                articulos_reingresados_count=reingresados_count,
                todos_reingresados=todos_reing,
            )
        )

    diligencias.sort(key=lambda d: d.fecha_acta, reverse=True)
    return diligencias


@router.get(
    "/{id_contrato}",
    response_model=CreditoResponse,
    summary="Obtener crédito por ID de contrato",
    status_code=status.HTTP_200_OK,
)
async def obtener_credito(
    id_contrato: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Consulta la información detallada de un crédito. Requiere autenticación."""
    credito = await crud_credito.get_credito(db=db, id_contrato=id_contrato)
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID de contrato '{id_contrato}' no encontrado",
        )
    return credito


@router.get(
    "/{id_contrato}/recibo-pdf",
    summary="Generar Recibo Digital de Venta (PDF) - Formato Talonario Remundial",
    description="Genera el comprobante digital oficial de venta inicial y contrato en formato PDF con la estructura del talonario físico de Remundial Arte's.",
    status_code=status.HTTP_200_OK,
)
async def descargar_recibo_venta_pdf(
    id_contrato: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_user_from_header_or_query),
):
    """Genera en tiempo real el comprobante PDF oficial de venta/crédito sin alterar ninguna tabla ni estado."""
    credito = await crud_credito.get_credito_por_id_o_hash(db=db, id_o_hash=id_contrato)
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito o venta con ID o código '{id_contrato}' no encontrado.",
        )

    # Autorización RBAC: Permitir la descarga directa del comprobante a cualquier usuario/vendedor activo autenticado
    if not current_user.estado_activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo en el sistema.",
        )

    pdf_bytes = generar_pdf_recibo_venta(credito)
    cliente_nombre = "Cliente"
    if credito.cliente:
        cliente_nombre = getattr(credito.cliente, "nombre_completo", None) or getattr(credito.cliente, "nombres", "Cliente")
    codigo_ctr = f"CTR-{str(credito.id_contrato)[:8].upper()}"
    fecha_emision = getattr(credito, "creado_en", None)
    filename = construir_nombre_archivo_pdf("Venta", codigo_ctr, cliente_nombre, fecha_emision)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


class FirmasContratoRequest(BaseModel):
    firma_titular: Optional[str] = None
    firma_cliente: Optional[str] = None
    firma_vendedor: Optional[str] = None
    firma_supervisor: Optional[str] = None
    firma_cajero: Optional[str] = None
    firma_codeudor: Optional[str] = None


@router.post(
    "/{id_contrato}/firmas",
    summary="Almacenar o actualizar firmas táctiles del contrato",
    status_code=status.HTTP_200_OK,
)
async def guardar_firmas_endpoint(
    id_contrato: str,
    firmas_in: FirmasContratoRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    credito = await crud_credito.get_credito_por_id_o_hash(db=db, id_o_hash=id_contrato)
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito o venta con ID o código '{id_contrato}' no encontrado.",
        )

    firma_cli = firmas_in.firma_cliente or firmas_in.firma_titular
    firma_sup = firmas_in.firma_supervisor or firmas_in.firma_vendedor
    guardar_firmas_contrato(
        id_contrato=credito.id_contrato,
        firma_titular=firma_cli,
        firma_cliente=firma_cli,
        firma_vendedor=firmas_in.firma_vendedor or firma_sup,
        firma_supervisor=firma_sup,
        firma_cajero=firmas_in.firma_cajero,
        firma_codeudor=firmas_in.firma_codeudor,
    )
    return {
        "mensaje": "Firmas táctiles guardadas correctamente",
        "id_contrato": str(credito.id_contrato),
    }


@router.get(
    "",
    response_model=List[CreditoResponse],
    summary="Listar créditos",
    status_code=status.HTTP_200_OK,
)
async def listar_creditos(
    skip: int = Query(0, ge=0, description="Registros a omitir para paginación"),
    limit: int = Query(100, ge=1, le=500, description="Límite de registros a retornar"),
    cliente_id: Optional[UUID] = Query(None, description="Filtrar por cliente"),
    vendedor_id: Optional[UUID] = Query(None, description="Filtrar por vendedor"),
    cobrador_id: Optional[UUID] = Query(None, description="Filtrar por cobrador asignado"),
    estado: Optional[EstadoCredito] = Query(None, description="Filtrar por estado del crédito"),
    fecha: Optional[date] = Query(None, description="Filtrar por fecha de creación (YYYY-MM-DD)"),
    ciudad_venta: Optional[str] = Query(None, description="Filtrar por ciudad o municipio de venta"),
    numero_contrato: Optional[str] = Query(None, description="Filtrar por número de contrato"),
    solo_exigibles: Optional[bool] = Query(None, description="Filtrar cuotas exigibles hoy o vencidas"),
    solo_cartera_critica: Optional[bool] = Query(None, description="Filtrar créditos en cartera crítica (>= 3 cuotas vencidas)"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Lista los créditos registrados en el sistema. Requiere autenticación.
    
    Seguridad RBAC:
    - Si el usuario en sesión es VENDEDOR, se acota estrictamente a sus ventas originadas.
    """
    vendedor_filtro = vendedor_id
    if current_user.rol == RolUsuario.VENDEDOR:
        vendedor_filtro = current_user.id

    return await crud_credito.get_creditos(
        db=db,
        skip=skip,
        limit=limit,
        cliente_id=cliente_id,
        vendedor_id=vendedor_filtro,
        cobrador_id=cobrador_id,
        estado=estado,
        fecha=fecha,
        ciudad_venta=ciudad_venta,
        numero_contrato=numero_contrato,
        solo_exigibles=solo_exigibles,
        solo_cartera_critica=solo_cartera_critica,
    )


@router.post(
    "/{id_contrato}/orden-retiro",
    response_model=OrdenRetiroResponse,
    summary="Registrar orden de retiro y generar Acta de Restitución de Bienes por Mora Crítica",
    status_code=status.HTTP_200_OK,
)
async def registrar_orden_retiro(
    id_contrato: str,
    orden_in: OrdenRetiroRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Registra la orden de retiro por mora con doble firma (cliente y cobrador) y genera el Acta oficial en PDF."""
    credito = await crud_credito.get_credito_por_id_o_hash(db=db, id_o_hash=id_contrato)
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID o código '{id_contrato}' no encontrado.",
        )

    # Validar exclusión estricta de créditos con plazo total de 2 cuotas
    if (credito.numero_cuotas or 0) <= 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Los créditos con plazo total de 2 cuotas no aplican para orden de retiro por mora crítica.",
        )

    cobrador_nombre = (
        orden_in.cobrador_nombre
        or getattr(current_user, "nombre_completo", None)
        or getattr(current_user, "nombre", None)
        or "Gestor de Cobro Autorizado"
    )

    # Guardar firmas en disco para trazabilidad
    guardar_firmas_acta(
        id_contrato=credito.id_contrato,
        firma_cliente=orden_in.firma_cliente,
        firma_cobrador=orden_in.firma_cobrador,
    )

    # Generar el PDF oficial del acta de restitución
    dt_local = obtener_timestamp_local_servidor(None)
    pdf_bytes = generar_pdf_acta_restitucion(
        credito=credito,
        motivo=orden_in.motivo,
        cobrador_nombre=cobrador_nombre,
        firma_cliente_b64=orden_in.firma_cliente,
        firma_cobrador_b64=orden_in.firma_cobrador,
        observaciones=orden_in.observaciones,
        fecha_hora=dt_local,
    )

    # Calcular cuotas vencidas para el resumen
    cuotas_vencidas_count = getattr(credito, "cuotas_vencidas_count", 0)
    if not cuotas_vencidas_count and credito.fecha_primera_cuota:
        res_c = generar_cronograma_con_arrastre(
            fecha_primera_cuota=credito.fecha_primera_cuota,
            numero_cuotas=credito.numero_cuotas,
            monto_financiado=credito.monto_financiado or Decimal("0.00"),
            saldo_pendiente=credito.saldo_pendiente or Decimal("0.00"),
            valor_cuota_base=credito.valor_cuota or Decimal("0.00"),
            tipo_pago=credito.tipo_pago or TipoPago.MENSUAL,
        )
        cuotas_vencidas_count = res_c.get("cuotas_vencidas_count", 3)

    # Persistir PDF físico y metadata JSON para el panel de supervisión
    cid_str = str(credito.id_contrato).lower()
    acta_pdf_path = os.path.join(ACTAS_DIR, f"{cid_str}_acta.pdf")
    try:
        with open(acta_pdf_path, "wb") as f:
            f.write(pdf_bytes)
    except Exception as e:
        print(f"[Acta] Error guardando PDF físico: {e}")

    meta_path = os.path.join(ACTAS_DIR, f"{cid_str}_metadata.json")
    articulos_list = []
    if credito.detalles:
        for d in credito.detalles:
            articulos_list.append({
                "producto_id": str(d.producto_id),
                "nombre": getattr(d.producto, "nombre", None) or d.descripcion or "Artículo de catálogo",
                "sku": getattr(d.producto, "sku", None),
                "cantidad": d.cantidad or 1,
                "reingresado": False,
                "fecha_reingreso": None,
                "reingresado_por": None,
                "observaciones_reingreso": None,
            })
    metadata_payload = {
        "id_contrato": str(credito.id_contrato),
        "fecha_acta": dt_local.strftime("%Y-%m-%d %H:%M:%S"),
        "motivo": orden_in.motivo or "Mora crítica mayor o igual a 3 cuotas",
        "observaciones": orden_in.observaciones,
        "cobrador_nombre": cobrador_nombre,
        "cuotas_vencidas": cuotas_vencidas_count or 3,
        "saldo_pendiente": float(credito.saldo_pendiente or 0),
        "articulos": articulos_list,
    }
    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata_payload, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Acta] Error guardando metadata JSON: {e}")

    return OrdenRetiroResponse(
        id_contrato=credito.id_contrato,
        mensaje="Orden de retiro registrada y Acta de Restitución generada exitosamente.",
        fecha_acta=dt_local.strftime("%Y-%m-%d %H:%M:%S"),
        pdf_url=f"/creditos/{credito.id_contrato}/acta-pdf",
        cuotas_vencidas=cuotas_vencidas_count or 3,
        saldo_pendiente=credito.saldo_pendiente or Decimal("0.00"),
    )


@router.get(
    "/{id_contrato}/acta-pdf",
    summary="Descargar o Visualizar Acta de Restitución de Bienes por Mora (PDF)",
    status_code=status.HTTP_200_OK,
)
async def descargar_acta_restitucion_pdf(
    id_contrato: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_user_from_header_or_query),
):
    """Genera o recupera el PDF del Acta de Restitución de Bienes por Mora."""
    credito = await crud_credito.get_credito_por_id_o_hash(db=db, id_o_hash=id_contrato)
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID o código '{id_contrato}' no encontrado.",
        )

    # Verificar si ya existe una copia física generada en almacenamiento
    cid_str = str(credito.id_contrato).lower()
    acta_path = os.path.join(ACTAS_DIR, f"{cid_str}_acta.pdf")
    if os.path.exists(acta_path):
        try:
            with open(acta_path, "rb") as f:
                pdf_bytes = f.read()
        except Exception:
            pdf_bytes = generar_pdf_acta_restitucion(credito=credito)
    else:
        pdf_bytes = generar_pdf_acta_restitucion(credito=credito)

    cliente_nom = "Cliente"
    if credito.cliente:
        cliente_nom_raw = (
            getattr(credito.cliente, "nombre_completo", None)
            or getattr(credito.cliente, "nombres", "Cliente")
        )
        cliente_nom = "".join(c for c in str(cliente_nom_raw) if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
    nombre_archivo = f"Acta_Restitucion_CTR-{cid_str[:8].upper()}_{cliente_nom}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{nombre_archivo}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.post(
    "/{id_contrato}/reingresar-articulo",
    response_model=ReingresoStockResponse,
    summary="Autorizar reingreso de artículo retirado a inventario comercial (Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
async def reingresar_articulo_stock(
    id_contrato: str,
    reingreso_in: ReingresoStockRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Acción administrativa para reincorporar un artículo restituido al stock disponible de venta."""
    credito = await crud_credito.get_credito_por_id_o_hash(db=db, id_o_hash=id_contrato)
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID o código '{id_contrato}' no encontrado.",
        )

    # 1. Buscar producto en catálogo
    from app.crud import crud_producto
    producto = await crud_producto.get_producto(db=db, producto_id=reingreso_in.producto_id)
    if not producto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Producto con ID '{reingreso_in.producto_id}' no encontrado en el catálogo.",
        )

    # 2. Reingresar al stock comercial y asegurar estado activo
    producto.stock += reingreso_in.cantidad
    producto.estado_activo = True
    await db.commit()
    await db.refresh(producto)

    # 3. Actualizar metadata del acta
    cid_str = str(credito.id_contrato).lower()
    meta_path = os.path.join(ACTAS_DIR, f"{cid_str}_metadata.json")
    meta_data = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta_data = json.load(f)
        except Exception:
            meta_data = {}

    dt_now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    supervisor_nombre = getattr(current_user, "nombre_completo", None) or getattr(current_user, "nombre", "Supervisor")

    articulos = meta_data.get("articulos", [])
    updated_in_meta = False
    for a in articulos:
        if str(a.get("producto_id")) == str(reingreso_in.producto_id):
            a["reingresado"] = True
            a["fecha_reingreso"] = dt_now_str
            a["reingresado_por"] = supervisor_nombre
            a["observaciones_reingreso"] = reingreso_in.observaciones or reingreso_in.condicion
            updated_in_meta = True
            break

    if not updated_in_meta:
        articulos.append({
            "producto_id": str(producto.id),
            "nombre": producto.nombre,
            "sku": producto.sku,
            "cantidad": reingreso_in.cantidad,
            "reingresado": True,
            "fecha_reingreso": dt_now_str,
            "reingresado_por": supervisor_nombre,
            "observaciones_reingreso": reingreso_in.observaciones or reingreso_in.condicion,
        })
        meta_data["articulos"] = articulos

    meta_data["id_contrato"] = cid_str
    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Acta] Error actualizando metadata tras reingreso: {e}")

    return ReingresoStockResponse(
        id_contrato=credito.id_contrato,
        producto_id=producto.id,
        producto_nombre=producto.nombre,
        producto_sku=producto.sku,
        cantidad_reingresada=reingreso_in.cantidad,
        nuevo_stock=producto.stock,
        reingresado=True,
        mensaje=f"Artículo '{producto.nombre}' reingresado a inventario comercial como '{reingreso_in.condicion}'. Nuevo stock disponible: {producto.stock} unidades.",
    )


@router.patch(
    "/{id_contrato}",
    response_model=CreditoResponse,
    summary="Actualizar estado o datos de un crédito (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
@router.put(
    "/{id_contrato}",
    response_model=CreditoResponse,
    summary="Actualizar estado o datos de un crédito (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
async def actualizar_credito(
    id_contrato: str,
    credito_in: CreditoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Actualiza administrativamente el crédito (ej: estado activo, supervisor asignado)."""
    try:
        uuid_obj = UUID(str(id_contrato).strip())
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Identificador de contrato '{id_contrato}' inválido.",
        )

    credito = await crud_credito.update_credito(
        db=db,
        id_contrato=uuid_obj,
        credito_in=credito_in,
        supervisor_id=current_user.id if current_user.rol in (RolUsuario.SUPERVISOR, RolUsuario.MASTER) else None,
    )
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID '{id_contrato}' no encontrado.",
        )
    return credito


class AprobarCreditoBody(BaseModel):
    cobrador_id: Optional[UUID] = None


@router.post(
    "/{id_contrato}/aprobar",
    response_model=CreditoResponse,
    summary="Aprobar crédito pendiente y activarlo en cartera (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
@router.patch(
    "/{id_contrato}/aprobar",
    response_model=CreditoResponse,
    summary="Aprobar crédito pendiente y activarlo en cartera (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
async def aprobar_credito(
    id_contrato: str,
    cobrador_id: Optional[UUID] = Query(None, description="Cobrador asignado de forma permanente"),
    body: Optional[AprobarCreditoBody] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Aprueba formalmente un crédito pendiente, cambiando su estado a 'activo' y fijando cobrador si se asigna."""
    try:
        uuid_obj = UUID(str(id_contrato).strip())
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Identificador de contrato '{id_contrato}' inválido.",
        )

    target_cobrador = cobrador_id or (body.cobrador_id if body else None)

    credito = await crud_credito.aprobar_credito(
        db=db,
        id_contrato=uuid_obj,
        supervisor_id=current_user.id,
        cobrador_id=target_cobrador,
    )
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID '{id_contrato}' no encontrado.",
        )
    return credito


@router.post(
    "/{id_contrato}/rechazar",
    response_model=CreditoResponse,
    summary="Rechazar crédito pendiente (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
@router.patch(
    "/{id_contrato}/rechazar",
    response_model=CreditoResponse,
    summary="Rechazar crédito pendiente (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
async def rechazar_credito(
    id_contrato: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Rechaza formalmente un crédito pendiente, cambiándolo a terminado sin saldo."""
    try:
        uuid_obj = UUID(str(id_contrato).strip())
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Identificador de contrato '{id_contrato}' inválido.",
        )

    credito = await crud_credito.rechazar_credito(
        db=db,
        id_contrato=uuid_obj,
        supervisor_id=current_user.id,
    )
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID '{id_contrato}' no encontrado.",
        )
    return credito
