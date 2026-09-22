from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProductoBase(BaseModel):
    """Esquema base para Producto."""
    sku: str = Field(..., min_length=2, max_length=50, description="Código de inventario único (SKU)")
    nombre: str = Field(..., min_length=2, max_length=200, description="Nombre o descripción del producto")
    precio_base: Decimal = Field(..., ge=0, description="Precio de referencia base")
    es_precio_variable: bool = Field(
        False,
        description="Indica si el precio es negociable al vender (ej. obras de arte)",
    )
    stock: int = Field(
        0,
        ge=0,
        description="Existencias físicas disponibles en almacén",
    )
    maneja_stock: bool = Field(
        True,
        description="Indica si controla inventario físico (False para cuadros sobre pedido)",
    )
    estado_activo: bool = Field(
        True,
        description="Estado operativo del artículo en el catálogo (activo o inactivo)",
    )
    imagen_url: Optional[str] = Field(
        None,
        max_length=500,
        description="URL relativa o absoluta de la imagen del producto",
    )


class ProductoCreate(ProductoBase):
    """Esquema para la creación de un producto."""
    pass


class ProductoUpdate(BaseModel):
    """Esquema para actualización de producto (todos los campos opcionales)."""
    sku: Optional[str] = Field(None, min_length=2, max_length=50)
    nombre: Optional[str] = Field(None, min_length=2, max_length=200)
    precio_base: Optional[Decimal] = Field(None, ge=0)
    es_precio_variable: Optional[bool] = None
    stock: Optional[int] = Field(None, ge=0, description="Existencias físicas disponibles")
    maneja_stock: Optional[bool] = Field(
        None, description="Indica si controla inventario físico"
    )
    imagen_url: Optional[str] = Field(
        None, max_length=500, description="URL de la imagen del producto"
    )
    estado_activo: Optional[bool] = Field(
        None, description="Permite activar o desactivar lógicamente el producto"
    )


class ProductoResponse(ProductoBase):
    """Esquema de respuesta de producto con metadatos y trazabilidad."""
    id: UUID
    creado_en: datetime
    actualizado_en: datetime

    model_config = ConfigDict(from_attributes=True)


class ReabastecerStockRequest(BaseModel):
    """Esquema para solicitud de recarga / reabastecimiento de inventario."""
    cantidad: int = Field(
        ...,
        gt=0,
        description="Cantidad física de unidades a ingresar al almacén",
    )
    motivo: Optional[str] = Field(
        "Entrada de almacén",
        description="Motivo o referencia del reabastecimiento",
    )


class ReabastecerStockResponse(BaseModel):
    """Esquema de respuesta tras reabastecer un artículo."""
    producto_id: UUID
    sku: str
    nombre: str
    stock_anterior: int
    cantidad_ingresada: int
    stock_actual: int
    maneja_stock: bool
    mensaje: str

    model_config = ConfigDict(from_attributes=True)

