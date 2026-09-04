"""Esquemas de validación de datos (Pydantic)."""

from app.schemas.abono import (
    AbonoBase,
    AbonoCreate,
    AbonoResponse,
)
from app.schemas.cliente import (
    ClienteBase,
    ClienteCreate,
    ClienteResponse,
    ClienteUpdate,
    CoordenadasGPS,
)
from app.schemas.credito import (
    CreditoBase,
    CreditoCreate,
    CreditoDetalleBase,
    CreditoDetalleCreate,
    CreditoDetalleResponse,
    CreditoResponse,
    CreditoUpdate,
)
from app.schemas.producto import (
    ProductoBase,
    ProductoCreate,
    ProductoResponse,
    ProductoUpdate,
)
from app.schemas.usuario import (
    UsuarioBase,
    UsuarioCreate,
    UsuarioResponse,
    UsuarioUpdate,
)

__all__ = [
    # Usuario
    "UsuarioBase",
    "UsuarioCreate",
    "UsuarioResponse",
    "UsuarioUpdate",
    # Producto
    "ProductoBase",
    "ProductoCreate",
    "ProductoResponse",
    "ProductoUpdate",
    # Cliente
    "CoordenadasGPS",
    "ClienteBase",
    "ClienteCreate",
    "ClienteResponse",
    "ClienteUpdate",
    # Credito
    "CreditoBase",
    "CreditoCreate",
    "CreditoUpdate",
    "CreditoResponse",
    "CreditoDetalleBase",
    "CreditoDetalleCreate",
    "CreditoDetalleResponse",
    # Abono
    "AbonoBase",
    "AbonoCreate",
    "AbonoResponse",
]
