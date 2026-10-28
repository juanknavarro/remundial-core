from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EntidadBancariaBase(BaseModel):
    """Esquema base para entidad bancaria o pasarela de transferencias."""
    nombre: str = Field(..., min_length=2, max_length=100, description="Nombre de la entidad bancaria o billetera virtual")
    activa: bool = Field(default=True, description="Indica si la entidad está habilitada para selección en pagos")


class EntidadBancariaCreate(EntidadBancariaBase):
    """Payload para crear una nueva entidad bancaria."""
    pass


class EntidadBancariaUpdate(BaseModel):
    """Payload para actualizar nombre o estado de una entidad bancaria."""
    nombre: Optional[str] = Field(None, min_length=2, max_length=100)
    activa: Optional[bool] = None


class EntidadBancariaResponse(EntidadBancariaBase):
    """Esquema de salida para entidad bancaria."""
    id: UUID
    creado_en: datetime

    model_config = ConfigDict(from_attributes=True)
