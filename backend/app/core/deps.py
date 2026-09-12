from typing import List, Optional
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
import jwt

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.usuario import RolUsuario, Usuario
from sqlalchemy.ext.asyncio import AsyncSession

# Esquema OAuth2 Bearer apuntando a la ruta de inicio de sesión
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Usuario:
    """Extrae, valida y decodifica el token Bearer JWT, retornando el usuario autenticado."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales de autenticación inválidas",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(token)
        user_id_str: str = payload.get("sub")
        if not user_id_str:
            raise credentials_exception
        user_id = UUID(user_id_str)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El token de acceso ha expirado. Inicie sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise credentials_exception

    user = await db.get(Usuario, user_id)
    if not user:
        raise credentials_exception

    if not user.estado_activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo en el sistema. Contacte a un supervisor.",
        )

    return user


async def get_user_from_header_or_query(
    token_query: Optional[str] = Query(None, alias="token"),
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> Usuario:
    """Valida autenticación vía Bearer header o parámetro de consulta ?token= (útil para visualización directa en navegador)."""
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif token_query:
        token = token_query.strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticación requerida para generar o descargar comprobantes.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(token)
        user_id_str: str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token no contiene identificador de usuario válido.")
        user_id = UUID(user_id_str)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token de acceso inválido o expirado.")

    user = await db.get(Usuario, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no encontrado en la base de datos.")

    if not user.estado_activo:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo en el sistema.")

    return user


class RoleChecker:
    """Verificador de permisos RBAC inyectable como dependencia en endpoints."""

    def __init__(self, allowed_roles: List[RolUsuario]):
        self.allowed_roles = allowed_roles

    def __call__(
        self, current_user: Usuario = Depends(get_current_user)
    ) -> Usuario:
        # El rol MASTER / Superusuario posee autorización absoluta en todos los endpoints
        if current_user.rol == RolUsuario.MASTER:
            return current_user

        if current_user.rol not in self.allowed_roles:
            roles_permitidos = [r.value for r in self.allowed_roles]
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Permisos insuficientes. El rol '{current_user.rol.value}' no tiene autorización. "
                    f"Roles requeridos: {roles_permitidos}"
                ),
            )
        return current_user


# Dependencias preconfiguradas para acceso rápido
require_cobrador_o_supervisor = RoleChecker([RolUsuario.COBRADOR, RolUsuario.SUPERVISOR])
require_vendedor_o_supervisor = RoleChecker([RolUsuario.VENDEDOR, RolUsuario.SUPERVISOR])
require_supervisor_o_secretaria = RoleChecker([RolUsuario.SUPERVISOR, RolUsuario.SECRETARIA])
require_supervisor = RoleChecker([RolUsuario.SUPERVISOR])
