from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, verify_password
from app.models.usuario import Usuario
from app.schemas.usuario import UsuarioResponse

router = APIRouter(
    prefix="/auth",
    tags=["Autenticación"],
)


class TokenResponse(BaseModel):
    """Respuesta con token de acceso JWT y datos del usuario autenticado."""
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioResponse


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Iniciar sesión y obtener token de acceso JWT",
    status_code=status.HTTP_200_OK,
)
async def login_para_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """Autentica a un usuario mediante su teléfono o nombre de usuario y contraseña."""
    identificador = form_data.username.strip()

    # Buscar usuario por teléfono exacto o por nombre (insensible a mayúsculas)
    query = select(Usuario).where(
        or_(
            Usuario.telefono == identificador,
            Usuario.nombre.ilike(identificador),
        )
    )
    result = await db.execute(query)
    usuario = result.scalar_one_or_none()

    if not usuario or not verify_password(form_data.password, usuario.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Credenciales incorrectas. Verifique su identificador o contraseña.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not usuario.estado_activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El usuario se encuentra inactivo. Contacte al administrador.",
        )

    # Crear token con el identificador UUID y metadatos de rol
    payload = {
        "sub": str(usuario.id),
        "rol": usuario.rol.value,
        "nombre": usuario.nombre,
    }
    access_token = create_access_token(data=payload)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "usuario": usuario,
    }


@router.get(
    "/me",
    response_model=UsuarioResponse,
    summary="Obtener perfil del usuario actualmente autenticado",
    status_code=status.HTTP_200_OK,
)
async def obtener_perfil_actual(
    current_user: Usuario = Depends(get_current_user),
):
    """Devuelve los datos del usuario autenticado a partir de su Bearer token."""
    return current_user
