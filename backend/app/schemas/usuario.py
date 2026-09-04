from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.usuario import RolUsuario


class UsuarioBase(BaseModel):
    """Esquema base con atributos comunes de usuario."""
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre completo del usuario")
    rol: RolUsuario = Field(..., description="Rol funcional del usuario")
    telefono: Optional[str] = Field(None, max_length=25, description="Número de teléfono de contacto (usado para login)")
    estado_activo: bool = Field(True, description="Estado operativo en el sistema")


class UsuarioCreate(UsuarioBase):
    """Esquema de entrada para crear un nuevo usuario con contraseña."""
    password: str = Field(
        ...,
        min_length=6,
        max_length=72,
        description="Contraseña en texto plano a ser hasheada de forma segura",
    )


class UsuarioUpdate(BaseModel):
    """Esquema para actualizar datos de un usuario (campos opcionales)."""
    nombre: Optional[str] = Field(None, min_length=2, max_length=150)
    rol: Optional[RolUsuario] = None
    telefono: Optional[str] = Field(None, max_length=25)
    estado_activo: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=6, max_length=72)


class UsuarioResponse(UsuarioBase):
    """Esquema de salida con datos públicos y trazabilidad (sin exponer password_hash)."""
    id: UUID
    creado_en: datetime
    actualizado_en: datetime

    model_config = ConfigDict(from_attributes=True)
