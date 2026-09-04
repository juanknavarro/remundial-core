"""Módulo de operaciones CRUD para la base de datos."""

from app.crud import crud_abono, crud_cliente, crud_credito, crud_producto

__all__ = [
    "crud_abono",
    "crud_cliente",
    "crud_credito",
    "crud_producto",
]
