from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_supervisor
from app.crud import crud_venta_anulada
from app.models.usuario import RolUsuario, Usuario
from app.schemas.venta_anulada import (
    VentaAnuladaCreate,
    VentaAnuladaReembolsoUpdate,
    VentaAnuladaResponse,
)

router = APIRouter(prefix="/auditoria", tags=["Auditoría y Ventas Anuladas"])


def _formatear_respuesta(item) -> VentaAnuladaResponse:
    return VentaAnuladaResponse(
        id=item.id,
        fecha=item.fecha,
        vendedor_id=item.vendedor_id,
        vendedor_nombre=item.vendedor.nombre if item.vendedor else None,
        monto_total=item.monto_total,
        metodo_pago_original=item.metodo_pago_original,
        referencia_original=item.referencia_original,
        articulos_json=item.articulos_json,
        estado_devolucion=item.estado_devolucion,
        banco_destino_cliente=item.banco_destino_cliente,
        cuenta_destino_cliente=item.cuenta_destino_cliente,
        notas_vendedor=item.notas_vendedor,
        firma_vendedor=item.firma_vendedor,
        firma_cliente=item.firma_cliente,
        referencia_reembolso_oficina=item.referencia_reembolso_oficina,
        banco_origen_reembolso=item.banco_origen_reembolso,
        fecha_reembolso=item.fecha_reembolso,
        creado_en=item.creado_en,
    )


@router.post(
    "/anuladas",
    response_model=VentaAnuladaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar una venta rechazada/en cuarentena para anulación y devolución",
)
async def registrar_venta_anulada(
    datos: VentaAnuladaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Registra la anulación formal de una venta no consolidada por falta de stock.
    
    Permite registrar la devolución inmediata de efectivo en ruta o la solicitud de reembolso
    bancario que será legalizado por la oficina administrativa.
    """
    try:
        nueva = await crud_venta_anulada.crear_venta_anulada(
            db=db,
            obj_in=datos,
            vendedor_id_auth=current_user.id,
        )
        obj = await crud_venta_anulada.get_venta_anulada(db, nueva.id)
        return _formatear_respuesta(obj or nueva)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al registrar la anulación: {str(exc)}",
        )


@router.get(
    "/anuladas",
    response_model=List[VentaAnuladaResponse],
    summary="Listar registros de ventas anuladas y devoluciones",
)
async def listar_ventas_anuladas(
    estado: Optional[str] = Query(None, description="Filtrar por estado_devolucion"),
    vendedor_id: Optional[UUID] = Query(None, description="Filtrar por ID de vendedor"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Lista las ventas anuladas. Los supervisores pueden ver todo; los vendedores ven sus registros."""
    filtro_vendedor = vendedor_id
    if current_user.rol == RolUsuario.VENDEDOR:
        filtro_vendedor = current_user.id

    items = await crud_venta_anulada.get_ventas_anuladas(
        db=db,
        estado=estado,
        vendedor_id=filtro_vendedor,
        skip=skip,
        limit=limit,
    )
    return [_formatear_respuesta(it) for it in items]


@router.patch(
    "/anuladas/{id}/reembolsar",
    response_model=VentaAnuladaResponse,
    summary="Legalizar devolución por transferencia desde la oficina",
)
async def reembolsar_venta_anulada(
    id: UUID,
    datos: VentaAnuladaReembolsoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Legaliza el reintegro de dinero por transferencia bancaria emitiendo el comprobante de giro."""
    actualizado = await crud_venta_anulada.reembolsar_venta_anulada(
        db=db,
        id=id,
        obj_in=datos,
    )
    if not actualizado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Venta anulada con ID '{id}' no encontrada",
        )
    return _formatear_respuesta(actualizado)
