from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CoordenadasGPS(BaseModel):
    """Par de coordenadas geográficas en formato decimal (WGS84)."""
    longitud: float = Field(..., ge=-180.0, le=180.0, description="Longitud geográfica (X)")
    latitud: float = Field(..., ge=-90.0, le=90.0, description="Latitud geográfica (Y)")

    model_config = ConfigDict(from_attributes=True)


class ClienteBase(BaseModel):
    """Esquema base de cliente con atributos principales."""
    cedula: str = Field(..., min_length=4, max_length=30, description="Número de cédula o identificación")
    nombres: str = Field(..., min_length=2, max_length=150, description="Nombres y apellidos completos")
    telefono: Optional[str] = Field(None, max_length=25, description="Teléfono principal de contacto")
    direccion: str = Field(..., min_length=3, description="Dirección del domicilio")
    barrio: Optional[str] = Field(None, max_length=100, description="Barrio o sector")
    ciudad: str = Field(..., min_length=2, max_length=100, description="Ciudad o municipio")
    coordenadas_gps: Optional[CoordenadasGPS] = Field(
        None,
        description="Coordenadas GPS de ubicación del cliente para gestión de cobranza",
    )


class ClienteCreate(ClienteBase):
    """Esquema para creación de un nuevo cliente."""
    pass


class ClienteUpdate(BaseModel):
    """Esquema para actualización de cliente (todos los campos opcionales)."""
    cedula: Optional[str] = Field(None, min_length=4, max_length=30)
    nombres: Optional[str] = Field(None, min_length=2, max_length=150)
    telefono: Optional[str] = Field(None, max_length=25)
    direccion: Optional[str] = Field(None, min_length=3)
    barrio: Optional[str] = Field(None, max_length=100)
    ciudad: Optional[str] = Field(None, min_length=2, max_length=100)
    coordenadas_gps: Optional[CoordenadasGPS] = None


class CodeudorInfo(BaseModel):
    """Información del codeudor solidario registrado para el cliente."""
    nombre: str
    cedula: Optional[str] = None
    telefono: Optional[str] = None
    direccion: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ReferenciaFamiliarInfo(BaseModel):
    """Información de la referencia familiar registrada para el cliente."""
    nombre: str
    telefono: Optional[str] = None
    parentesco: Optional[str] = "Familiar"
    direccion: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ClienteResponse(ClienteBase):
    """Esquema de respuesta para cliente con identificador, auditoría y garantías heredables."""
    id: UUID
    creado_en: datetime
    actualizado_en: datetime
    codeudor: Optional[CodeudorInfo] = None
    referencia_familiar: Optional[ReferenciaFamiliarInfo] = None

    model_config = ConfigDict(from_attributes=True)
