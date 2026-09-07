from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    get_current_user,
    require_supervisor,
    require_supervisor_o_secretaria,
)
from app.core.security import get_password_hash
from app.models.usuario import RolUsuario, Usuario
from app.schemas.usuario import UsuarioCreate, UsuarioResponse, UsuarioUpdate

router = APIRouter(
    prefix="/usuarios",
    tags=["Usuarios"],
)


@router.get(
    "",
    response_model=List[UsuarioResponse],
    summary="Listar usuarios del sistema (Supervisor o Secretaria)",
    status_code=status.HTTP_200_OK,
)
async def listar_usuarios(
    rol: Optional[RolUsuario] = Query(None, description="Filtrar por rol funcional"),
    estado_activo: Optional[bool] = Query(None, description="Filtrar por estado activo/inactivo"),
    skip: int = Query(0, ge=0, description="Número de registros a omitir para paginación"),
    limit: int = Query(100, ge=1, le=200, description="Cantidad máxima de registros a retornar"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
) -> List[Usuario]:
    """Retorna la lista de usuarios registrados. Requiere rol 'supervisor' o 'secretaria'."""
    query = select(Usuario).offset(skip).limit(limit).order_by(Usuario.nombre.asc())

    if rol is not None:
        query = query.where(Usuario.rol == rol)
    if estado_activo is not None:
        query = query.where(Usuario.estado_activo == estado_activo)

    result = await db.execute(query)
    return list(result.scalars().all())


@router.post(
    "",
    response_model=UsuarioResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear un nuevo usuario con contraseña hasheada (Solo Supervisor)",
)
async def crear_usuario(
    usuario_in: UsuarioCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
) -> Usuario:
    """Registra un nuevo usuario en la base de datos con contraseña hasheada.
    
    Verifica que no exista otro usuario con el mismo teléfono si fue proporcionado.
    """
    if usuario_in.telefono:
        query_existente = select(Usuario).where(Usuario.telefono == usuario_in.telefono.strip())
        res_existente = await db.execute(query_existente)
        if res_existente.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ya existe un usuario registrado con el teléfono '{usuario_in.telefono}'",
            )

    nuevo_usuario = Usuario(
        nombre=usuario_in.nombre.strip(),
        rol=usuario_in.rol,
        telefono=usuario_in.telefono.strip() if usuario_in.telefono else None,
        estado_activo=usuario_in.estado_activo,
        password_hash=get_password_hash(usuario_in.password),
    )

    db.add(nuevo_usuario)
    await db.commit()
    await db.refresh(nuevo_usuario)
    return nuevo_usuario


@router.get(
    "/{usuario_id}",
    response_model=UsuarioResponse,
    summary="Obtener usuario por ID (Solo Supervisor)",
    status_code=status.HTTP_200_OK,
)
async def obtener_usuario(
    usuario_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
) -> Usuario:
    """Consulta la información detallada de un usuario por su identificador UUID."""
    clean_id = str(usuario_id).strip()
    try:
        uuid_obj = UUID(clean_id)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario con ID '{clean_id}' no encontrado.",
        )

    usuario = await db.get(Usuario, uuid_obj)

    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario con ID '{clean_id}' no encontrado.",
        )

    return usuario


@router.put(
    "/{usuario_id}",
    response_model=UsuarioResponse,
    summary="Actualizar datos o estado de un usuario (Solo Supervisor)",
    status_code=status.HTTP_200_OK,
)
async def actualizar_usuario(
    usuario_id: str,
    usuario_update: UsuarioUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
) -> Usuario:
    """Actualiza la información de un usuario existente.
    
    Permite modificar nombre, rol, teléfono, estado_activo y reestablecer contraseña.
    """
    clean_id = str(usuario_id).strip()
    try:
        uuid_obj = UUID(clean_id)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario con ID '{clean_id}' no encontrado.",
        )

    usuario = await db.get(Usuario, uuid_obj)

    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario con ID '{clean_id}' no encontrado.",
        )

    if usuario_update.nombre is not None:
        usuario.nombre = usuario_update.nombre.strip()

    if usuario_update.rol is not None:
        usuario.rol = usuario_update.rol

    if usuario_update.telefono is not None:
        # Si se actualiza el teléfono, verificar que no colisione con otro usuario
        telefono_limpio = usuario_update.telefono.strip()
        query_tel = select(Usuario).where(
            Usuario.telefono == telefono_limpio,
            Usuario.id != uuid_obj,
        )
        res_tel = await db.execute(query_tel)
        if res_tel.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El teléfono '{telefono_limpio}' ya está en uso por otro colaborador.",
            )
        usuario.telefono = telefono_limpio

    if usuario_update.estado_activo is not None:
        usuario.estado_activo = usuario_update.estado_activo

    if usuario_update.password:
        usuario.password_hash = get_password_hash(usuario_update.password)

    await db.commit()
    await db.refresh(usuario)
    return usuario


@router.delete(
    "/{usuario_id}",
    summary="Eliminar o dar de baja a un usuario (Solo Supervisor)",
    status_code=status.HTTP_200_OK,
)
async def eliminar_usuario(
    usuario_id: str,
    baja_logica: bool = Query(True, description="Si es True realiza baja lógica (desactiva), si es False intenta eliminación física"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Inactiva (baja lógica) o elimina físicamente un usuario sin generar excepciones 422."""
    clean_id = str(usuario_id).strip()
    try:
        uuid_obj = UUID(clean_id)
    except (ValueError, TypeError, AttributeError):
        # Si no es un UUID válido (ej. mock 'u-0' o ID temporal), responder de forma limpia
        return {
            "mensaje": f"El registro '{clean_id}' no correspondía a un identificador persistido en base de datos. Se procesó correctamente."
        }

    usuario = await db.get(Usuario, uuid_obj)

    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario con ID '{clean_id}' no encontrado en el sistema.",
        )

    # Evitar estrictamente que el usuario elimine o inactive su propia sesión activa
    if usuario.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Operación no permitida: No puedes eliminar ni inactivar tu propia cuenta en sesión activa.",
        )

    if baja_logica:
        usuario.estado_activo = False
        await db.commit()
        return {"mensaje": f"Usuario '{usuario.nombre}' inactivado exitosamente (baja lógica)."}
    else:
        try:
            await db.delete(usuario)
            await db.commit()
            return {"mensaje": f"Usuario '{usuario.nombre}' eliminado físicamente del sistema."}
        except Exception:
            await db.rollback()
            # Si hay integridad referencial con créditos o abonos, aplicar baja lógica
            usuario.estado_activo = False
            await db.commit()
            return {
                "mensaje": f"El usuario tiene historial de operaciones. Se procedió con baja lógica (inactivación)."
            }
