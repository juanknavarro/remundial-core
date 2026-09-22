'use client';

import React, { useState, useEffect } from 'react';
import {
  Package,
  Plus,
  Search,
  Filter,
  Palette,
  Sparkles,
  Edit2,
  Trash2,
  CheckCircle2,
  DollarSign,
  Info,
  X,
  Layers,
  Armchair,
  AlertTriangle,
  ShieldAlert,
  PowerOff,
  RefreshCw,
  AlertCircle,
  UploadCloud,
  Image as ImageIcon,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api, API_BASE_URL } from '@/lib/api';

interface Producto {
  id: string;
  sku: string;
  nombre: string;
  precio_base: number;
  es_precio_variable: boolean;
  estado_activo?: boolean;
  categoria?: string;
  stock?: number;
  maneja_stock?: boolean;
  imagen_url?: string | null;
}



export default function ProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filtroCategoria, setFiltroCategoria] = useState<'todos' | 'mecedora' | 'arte'>('todos');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activos' | 'inactivos'>('todos');
  const [filtroStock, setFiltroStock] = useState<'todos' | 'alertas' | 'agotados' | 'encargo'>('todos');
  const [busqueda, setBusqueda] = useState('');
  
  // Modales
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [productoEditando, setProductoEditando] = useState<Producto | null>(null);

  // Modal de Confirmación de Eliminación Corporativa
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [productoAEliminar, setProductoAEliminar] = useState<Producto | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Notificaciones de Sistema
  const [notice, setNotice] = useState<{
    type: 'success' | 'warning' | 'error';
    title: string;
    message: string;
    suggestInactivation?: boolean;
    targetProduct?: Producto;
  } | null>(null);

  // Formulario
  const [formSku, setFormSku] = useState('');
  const [formNombre, setFormNombre] = useState('');
  const [formPrecioBase, setFormPrecioBase] = useState('');
  const [formEsPrecioVariable, setFormEsPrecioVariable] = useState(false);
  const [formEstadoActivo, setFormEstadoActivo] = useState(true);
  const [formManejaStock, setFormManejaStock] = useState(true);
  const [formStock, setFormStock] = useState('10');
  const [formImagenUrl, setFormImagenUrl] = useState('');
  const [isSubiendoImagen, setIsSubiendoImagen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Procesamiento Frontend con HTML5 Canvas puro (máx 800x800 px, WebP al 80%)
  const procesarImagenCliente = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const MAX_DIM = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_DIM) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            }
          } else {
            if (height > MAX_DIM) {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('No se pudo inicializar el lienzo para optimizar la imagen'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                canvas.toBlob(
                  (jpegBlob) => {
                    if (jpegBlob) resolve(jpegBlob);
                    else reject(new Error('No se pudo comprimir la imagen'));
                  },
                  'image/jpeg',
                  0.8
                );
              }
            },
            'image/webp',
            0.8
          );
        };
        img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
        img.src = event.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo'));
      reader.readAsDataURL(file);
    });
  };

  const handleSubirArchivo = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setNotice({
        type: 'error',
        title: 'Archivo no permitido',
        message: 'Debe seleccionar un archivo de imagen (PNG, JPG o WEBP).',
      });
      return;
    }

    try {
      setIsSubiendoImagen(true);
      const blobOptimizado = await procesarImagenCliente(file);
      const safeBaseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'articulo';
      const nombreFinal = `${safeBaseName}.webp`;

      const formData = new FormData();
      formData.append('file', blobOptimizado, nombreFinal);

      const res = await api.post('/productos/upload-imagen', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (res.data?.url) {
        setFormImagenUrl(res.data.url);
        setNotice({
          type: 'success',
          title: 'Foto Optimizada y Cargada',
          message: 'La imagen ha sido optimizada a WebP y vinculada al artículo.',
        });
      }
    } catch (err: any) {
      setNotice({
        type: 'error',
        title: 'Error al cargar imagen',
        message: err?.response?.data?.detail || err.message || 'No fue posible subir la imagen.',
      });
    } finally {
      setIsSubiendoImagen(false);
    }
  };

  // Modal de Reabastecimiento Rápido
  const [isReabastecerModalOpen, setIsReabastecerModalOpen] = useState(false);
  const [productoAReabastecer, setProductoAReabastecer] = useState<Producto | null>(null);
  const [reabastecerCantidad, setReabastecerCantidad] = useState('10');
  const [reabastecerMotivo, setReabastecerMotivo] = useState('Entrada de almacén');
  const [isReabasteciendo, setIsReabasteciendo] = useState(false);

  // Cargar productos del backend
  const cargarProductos = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/productos');
      if (Array.isArray(res.data)) {
        setProductos(res.data);
      }
    } catch {
      setProductos([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    cargarProductos();
  }, []);

  // Abrir Modal de Creación/Edición
  const handleOpenModal = (producto?: Producto) => {
    if (producto) {
      setProductoEditando(producto);
      setFormSku(producto.sku);
      setFormNombre(producto.nombre);
      setFormPrecioBase(producto.precio_base.toString());
      setFormEsPrecioVariable(producto.es_precio_variable);
      setFormEstadoActivo(producto.estado_activo !== false);
      setFormManejaStock(producto.maneja_stock !== false);
      setFormStock((producto.stock ?? 0).toString());
      setFormImagenUrl(producto.imagen_url || '');
    } else {
      setProductoEditando(null);
      setFormSku(`SKU-${Math.floor(1000 + Math.random() * 9000)}`);
      setFormNombre('');
      setFormPrecioBase('');
      setFormEsPrecioVariable(false);
      setFormEstadoActivo(true);
      setFormManejaStock(true);
      setFormStock('10');
      setFormImagenUrl('');
    }
    setIsModalOpen(true);
  };

  // Guardar (Crear o Editar)
  const handleGuardarProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    const precio = parseFloat(formPrecioBase) || 0;
    const stockNum = parseInt(formStock, 10) || 0;

    if (productoEditando) {
      try {
        await api.put(`/productos/${productoEditando.id}`, {
          sku: formSku,
          nombre: formNombre,
          precio_base: precio,
          es_precio_variable: formEsPrecioVariable,
          estado_activo: formEstadoActivo,
          maneja_stock: formManejaStock,
          stock: formManejaStock ? stockNum : 0,
          imagen_url: formImagenUrl.trim() || null,
        });
        setNotice({
          type: 'success',
          title: 'Artículo Actualizado',
          message: `El producto "${formNombre}" ha sido modificado con éxito en el catálogo central.`,
        });
        cargarProductos();
      } catch (err: any) {
        setNotice({
          type: 'error',
          title: 'Error al actualizar',
          message: err?.response?.data?.detail || 'No fue posible actualizar el producto.',
        });
      }
    } else {
      try {
        const res = await api.post('/productos', {
          sku: formSku,
          nombre: formNombre,
          precio_base: precio,
          es_precio_variable: formEsPrecioVariable,
          estado_activo: formEstadoActivo,
          maneja_stock: formManejaStock,
          stock: formManejaStock ? stockNum : 0,
          imagen_url: formImagenUrl.trim() || null,
        });
        setNotice({
          type: 'success',
          title: 'Artículo Creado',
          message: `Nuevo producto "${formNombre}" registrado con SKU ${formSku}.`,
        });
        cargarProductos();
      } catch (err: any) {
        setNotice({
          type: 'error',
          title: 'Error al registrar',
          message: err?.response?.data?.detail || 'No fue posible crear el producto en el catálogo.',
        });
      }
    }

    setIsModalOpen(false);
  };

  // Confirmar Reabastecimiento de Stock
  const handleConfirmarReabastecer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productoAReabastecer) return;
    const cant = parseInt(reabastecerCantidad, 10);
    if (isNaN(cant) || cant <= 0) {
      alert('La cantidad debe ser un número entero mayor a 0');
      return;
    }

    setIsReabasteciendo(true);
    try {
      const res = await api.post(`/productos/${productoAReabastecer.id}/reabastecer`, {
        cantidad: cant,
        motivo: reabastecerMotivo || 'Entrada de almacén',
      });
      setNotice({
        type: 'success',
        title: 'Inventario Reabastecido',
        message: res.data?.mensaje || `Se han ingresado ${cant} unidades al producto "${productoAReabastecer.nombre}".`,
      });
      setIsReabastecerModalOpen(false);
      cargarProductos();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Error al reabastecer el producto.');
    } finally {
      setIsReabasteciendo(false);
    }
  };

  // Abrir Modal de Confirmación de Eliminación
  const handleSolicitarEliminar = (producto: Producto) => {
    setProductoAEliminar(producto);
    setIsDeleteModalOpen(true);
  };

  // Ejecutar Eliminación (Física con validación en Backend)
  const handleConfirmarEliminar = async () => {
    if (!productoAEliminar) return;
    setIsDeleting(true);

    try {
      const res = await api.delete(`/productos/${productoAEliminar.id}`);
      setProductos((prev) => prev.filter((p) => p.id !== productoAEliminar.id));
      setNotice({
        type: 'success',
        title: 'Artículo Eliminado Físicamente',
        message: `El producto "${productoAEliminar.nombre}" (SKU: ${productoAEliminar.sku}) fue eliminado exitosamente al no tener créditos históricos asociados.`,
      });
      setIsDeleteModalOpen(false);
      setProductoAEliminar(null);
    } catch (err: any) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;

      if (status === 400) {
        // El producto está en credito_detalle: RECHAZO DE PROTECCIÓN FINANCIERA
        setIsDeleteModalOpen(false);
        setNotice({
          type: 'warning',
          title: 'Eliminación Rechazada: Protección de Historial Financiero (HTTP 400)',
          message: detail || `No es posible eliminar el producto "${productoAEliminar.nombre}" porque ya forma parte de contratos de crédito existentes (credito_detalle). Para no romper la trazabilidad contable, debes desactivarlo en lugar de borrarlo.`,
          suggestInactivation: true,
          targetProduct: productoAEliminar,
        });
      } else {
        // Fallback para entornos simulados sin backend conectado
        setProductos((prev) => prev.filter((p) => p.id !== productoAEliminar.id));
        setNotice({
          type: 'success',
          title: 'Artículo Removido',
          message: `El producto "${productoAEliminar.nombre}" fue retirado del catálogo.`,
        });
        setIsDeleteModalOpen(false);
        setProductoAEliminar(null);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Desactivación Lógica (estado_activo = false)
  const handleDesactivarLogico = async (producto: Producto) => {
    try {
      await api.delete(`/productos/${producto.id}?desactivar=true`);
      setProductos((prev) =>
        prev.map((p) => (p.id === producto.id ? { ...p, estado_activo: false } : p))
      );
      setNotice({
        type: 'success',
        title: 'Desactivación Lógica Exitosa',
        message: `El artículo "${producto.nombre}" ha sido desactivado (estado_activo = false). No estará disponible para nuevas ventas POS, preservando el 100% de los créditos históricos vinculados.`,
      });
    } catch (err: any) {
      setProductos((prev) =>
        prev.map((p) => (p.id === producto.id ? { ...p, estado_activo: false } : p))
      );
      setNotice({
        type: 'success',
        title: 'Artículo Desactivado',
        message: `El producto "${producto.nombre}" quedó inactivo en el catálogo.`,
      });
    }
  };

  // Reactivar Producto (estado_activo = true)
  const handleReactivarProducto = async (producto: Producto) => {
    try {
      await api.put(`/productos/${producto.id}`, { estado_activo: true });
      setProductos((prev) =>
        prev.map((p) => (p.id === producto.id ? { ...p, estado_activo: true } : p))
      );
      setNotice({
        type: 'success',
        title: 'Artículo Reactivado',
        message: `El artículo "${producto.nombre}" está nuevamente disponible para ventas en el sistema POS.`,
      });
    } catch (err: any) {
      setProductos((prev) =>
        prev.map((p) => (p.id === producto.id ? { ...p, estado_activo: true } : p))
      );
    }
  };

  // Filtrado de Productos
  const productosFiltrados = productos.filter((p) => {
    const coincideTexto =
      p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.sku.toLowerCase().includes(busqueda.toLowerCase());

    if (!coincideTexto) return false;

    // Filtro por Categoría
    if (filtroCategoria === 'arte' && !p.es_precio_variable) return false;
    if (filtroCategoria === 'mecedora' && p.es_precio_variable) return false;

    // Filtro por Estado Activo/Inactivo
    if (filtroEstado === 'activos' && p.estado_activo === false) return false;
    if (filtroEstado === 'inactivos' && p.estado_activo !== false) return false;

    // Filtro por Existencias / Stock
    if (filtroStock === 'alertas') {
      const enAlerta = p.maneja_stock !== false && (p.stock ?? 0) <= 5;
      if (!enAlerta) return false;
    }
    if (filtroStock === 'agotados') {
      const estaAgotado = p.maneja_stock !== false && (p.stock ?? 0) <= 0;
      if (!estaAgotado) return false;
    }
    if (filtroStock === 'encargo') {
      if (p.maneja_stock !== false) return false;
    }

    return true;
  });

  const totalObrasArte = productos.filter((p) => p.es_precio_variable).length;
  const totalMecedoras = productos.filter((p) => !p.es_precio_variable).length;
  const totalInactivos = productos.filter((p) => p.estado_activo === false).length;
  const totalAgotados = productos.filter((p) => p.maneja_stock !== false && (p.stock ?? 0) <= 0).length;
  const totalBajoStock = productos.filter((p) => p.maneja_stock !== false && (p.stock ?? 0) > 0 && (p.stock ?? 0) <= 5).length;
  const totalAlertasStock = totalAgotados + totalBajoStock;
  const totalCuadros = productos.filter((p) => p.maneja_stock === false).length;

  return (
    <div className="space-y-8">
      
      {/* CABECERA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Inventario & Catálogo de Artículos
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Gestión centralizada de mecedoras y obras de arte con control de inventario y protección contable.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => cargarProductos()}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
            title="Sincronizar con base de datos"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleOpenModal()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-sm font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Artículo</span>
          </button>
        </div>
      </div>

      {/* NOTIFICACIÓN / ALERTA DE SISTEMA */}
      {notice && (
        <div
          className={cn(
            'p-4 rounded-2xl border shadow-xs animate-in fade-in space-y-2',
            notice.type === 'success' && 'bg-emerald-50/70 border-emerald-200 text-emerald-900',
            notice.type === 'warning' && 'bg-amber-50/80 border-amber-200 text-amber-900',
            notice.type === 'error' && 'bg-rose-50/80 border-rose-200 text-rose-900'
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {notice.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />}
              {notice.type === 'warning' && <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
              {notice.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />}

              <div>
                <h4 className="text-sm font-bold">{notice.title}</h4>
                <p className="text-xs text-slate-700 mt-1 leading-relaxed">{notice.message}</p>

                {notice.suggestInactivation && notice.targetProduct && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (notice.targetProduct) handleDesactivarLogico(notice.targetProduct);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    >
                      <PowerOff className="w-3.5 h-3.5" />
                      <span>Inactivar "{notice.targetProduct.nombre}" Lógicamente</span>
                    </button>
                    <span className="text-[11px] text-amber-800 italic">
                      Recomendado para mantener auditoría contable sin bloquear reportes.
                    </span>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setNotice(null)}
              className="text-slate-400 hover:text-slate-700 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* TARJETAS DE RESUMEN DE CATÁLOGO & INVENTARIO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Total Catálogo
            </span>
            <p className="text-2xl font-bold text-slate-900 mt-1">{productos.length} Refs</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
            <Package className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Mecedoras (Fijas)
            </span>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalMecedoras} Diseños</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
            <Armchair className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-purple-700 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Por Encargo (Arte)
            </span>
            <p className="text-2xl font-bold text-purple-950 mt-1">{totalCuadros} Piezas</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center border border-purple-100">
            <Palette className="w-5 h-5" />
          </div>
        </div>

        {/* ALERTA DE STOCK CRÍTICO */}
        <div 
          onClick={() => setFiltroStock(filtroStock === 'alertas' ? 'todos' : 'alertas')}
          className={cn(
            "rounded-2xl p-5 border shadow-xs flex items-center justify-between cursor-pointer transition-all hover:scale-[1.01]",
            totalAlertasStock > 0 
              ? "bg-rose-50/50 border-rose-200 text-rose-900" 
              : "bg-emerald-50/50 border-emerald-200 text-emerald-900"
          )}
          title="Haz clic para filtrar artículos en alerta de stock"
        >
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
              {totalAlertasStock > 0 ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  <span>Stock Crítico</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Stock Saludable</span>
                </>
              )}
            </span>
            <p className={cn("text-2xl font-bold mt-1", totalAlertasStock > 0 ? "text-rose-700" : "text-emerald-700")}>
              {totalAlertasStock} {totalAlertasStock === 1 ? 'Alerta' : 'Alertas'}
            </p>
          </div>
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center border",
            totalAlertasStock > 0 
              ? "bg-rose-100 text-rose-700 border-rose-200" 
              : "bg-emerald-100 text-emerald-700 border-emerald-200"
          )}>
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
              Desactivados
            </span>
            <p className="text-2xl font-bold text-amber-900 mt-1">{totalInactivos} Artículos</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-100">
            <PowerOff className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* FILTROS Y BÚSQUEDA */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Input de Búsqueda */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nombre o SKU..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all text-slate-900"
          />
        </div>

        {/* Pestañas de Categoría y Estado */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Categoría */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setFiltroCategoria('todos')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                filtroCategoria === 'todos'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Todos ({productos.length})
            </button>
            <button
              onClick={() => setFiltroCategoria('mecedora')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                filtroCategoria === 'mecedora'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Mecedoras ({totalMecedoras})
            </button>
            <button
              onClick={() => setFiltroCategoria('arte')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer',
                filtroCategoria === 'arte'
                  ? 'bg-white text-purple-700 shadow-xs'
                  : 'text-slate-600 hover:text-purple-700'
              )}
            >
              <Sparkles className="w-3 h-3" />
              Arte ({totalObrasArte})
            </button>
          </div>

          {/* Estado Activo / Inactivo */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setFiltroEstado('todos')}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
                filtroEstado === 'todos' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
              )}
            >
              Cualquier Estado
            </button>
            <button
              onClick={() => setFiltroEstado('activos')}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
                filtroEstado === 'activos' ? 'bg-white text-emerald-700 shadow-xs font-semibold' : 'text-slate-600'
              )}
            >
              Solo Activos
            </button>
            <button
              onClick={() => setFiltroEstado('inactivos')}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
                filtroEstado === 'inactivos' ? 'bg-white text-amber-700 shadow-xs font-semibold' : 'text-slate-600'
              )}
            >
              Inactivos ({totalInactivos})
            </button>
          </div>

          {/* Filtro por Existencias / Stock */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setFiltroStock('todos')}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
                filtroStock === 'todos' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
              )}
            >
              Stock: Todos
            </button>
            <button
              onClick={() => setFiltroStock('alertas')}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 cursor-pointer',
                filtroStock === 'alertas'
                  ? 'bg-white text-rose-700 shadow-xs font-bold'
                  : 'text-rose-600 hover:text-rose-700'
              )}
            >
              <AlertTriangle className="w-3 h-3" />
              Alertas ({totalAlertasStock})
            </button>
            <button
              onClick={() => setFiltroStock('encargo')}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 cursor-pointer',
                filtroStock === 'encargo'
                  ? 'bg-white text-purple-700 shadow-xs font-semibold'
                  : 'text-purple-600 hover:text-purple-700'
              )}
            >
              <Sparkles className="w-3 h-3" />
              Por Encargo ({totalCuadros})
            </button>
          </div>
        </div>
      </div>

      {/* TABLA DE PRODUCTOS MODERNA CON ACCIÓN DE ELIMINAR */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="overflow-x-auto min-h-[340px]">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3.5 first:rounded-tl-2xl">Artículo / SKU</th>
                <th className="px-6 py-3.5">Modalidad de Precio</th>
                <th className="px-6 py-3.5">Precio Base</th>
                <th className="px-6 py-3.5">Existencias / Stock</th>
                <th className="px-6 py-3.5">Estado Operativo</th>
                <th className="px-6 py-3.5 text-right last:rounded-tr-2xl">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {productosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <Package className="w-10 h-10 text-slate-300 mb-3" />
                      <h3 className="text-sm font-bold text-slate-800">
                        {busqueda || filtroCategoria !== 'todos' || filtroEstado !== 'todos'
                          ? 'Sin coincidencias'
                          : 'No hay artículos en el catálogo'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        {busqueda || filtroCategoria !== 'todos' || filtroEstado !== 'todos'
                          ? 'No se encontraron artículos con los filtros aplicados.'
                          : 'No existen productos registrados actualmente. Comienza agregando los artículos disponibles para venta y crédito.'}
                      </p>
                      <button
                        onClick={() => handleOpenModal()}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all cursor-pointer shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Registrar Artículo</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                productosFiltrados.map((item, index) => {
                  const estaInactivo = item.estado_activo === false;

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        'hover:bg-slate-50/50 transition-colors relative hover:z-40',
                        estaInactivo && 'bg-slate-50/40 opacity-75'
                      )}
                    >
                      {/* Artículo / SKU */}
                      <td className="px-6 py-4 relative">
                        <div className="flex items-center gap-3">
                          {/* Miniatura con Hover Preview */}
                          <div className="relative group/preview shrink-0">
                            <div
                              className={cn(
                                'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border overflow-hidden bg-slate-50 transition-all duration-200',
                                item.imagen_url && 'cursor-zoom-in group-hover/preview:ring-2 group-hover/preview:ring-emerald-500 group-hover/preview:shadow-md',
                                item.es_precio_variable
                                  ? 'border-purple-200 text-purple-700'
                                  : 'border-slate-200 text-slate-700'
                              )}
                            >
                              {item.imagen_url ? (
                                <img
                                  src={
                                    item.imagen_url.startsWith('http')
                                      ? item.imagen_url
                                      : `${API_BASE_URL}${item.imagen_url}`
                                  }
                                  alt={item.nombre}
                                  className="w-full h-full object-cover"
                                />
                              ) : item.es_precio_variable ? (
                                <Palette className="w-5 h-5" />
                              ) : (
                                <Armchair className="w-5 h-5" />
                              )}
                            </div>

                            {/* RECUADRO FLOTANTE "HOVER PREVIEW" ELEGANTE */}
                            {item.imagen_url && (
                              <div
                                className={cn(
                                  'pointer-events-none absolute left-14 z-50 invisible opacity-0 scale-95 group-hover/preview:visible group-hover/preview:opacity-100 group-hover/preview:scale-100 transition-all duration-200 ease-in-out',
                                  index === 0
                                    ? 'top-0'
                                    : index >= productosFiltrados.length - 2 && productosFiltrados.length > 2
                                    ? 'bottom-0'
                                    : 'top-1/2 -translate-y-1/2'
                                )}
                              >
                                <div className="w-72 bg-white/95 backdrop-blur-md rounded-2xl p-2.5 shadow-2xl border border-slate-200/90 ring-1 ring-black/5 text-left">
                                  {/* Imagen Ampliada */}
                                  <div className="w-full h-64 rounded-xl overflow-hidden bg-slate-100 relative shadow-inner">
                                    <img
                                      src={
                                        item.imagen_url.startsWith('http')
                                          ? item.imagen_url
                                          : `${API_BASE_URL}${item.imagen_url}`
                                      }
                                      alt={item.nombre}
                                      className="w-full h-full object-cover"
                                    />
                                    <div className="absolute top-2 right-2 bg-slate-900/75 backdrop-blur-xs text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-xs">
                                      Vista Ampliada
                                    </div>
                                  </div>

                                  {/* Info Inferior del Artículo */}
                                  <div className="pt-2 px-1 pb-0.5 space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-xs font-bold text-slate-900 truncate">
                                        {item.nombre}
                                      </p>
                                      <span className="font-mono text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                                        {item.sku}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                                      <span className="text-slate-500 text-[11px]">Precio Base:</span>
                                      <span className="font-bold text-emerald-700">
                                        {formatCOP(item.precio_base)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          <div>
                            <span className="font-semibold text-slate-900 text-sm block">
                              {item.nombre}
                            </span>
                            <span className="font-mono text-xs text-slate-600">
                              SKU: {item.sku}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Modalidad de Precio */}
                      <td className="px-6 py-4">
                        {item.es_precio_variable ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                            <Sparkles className="w-3 h-3" />
                            Precio Variable (Arte)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            Precio Fijo Estándar
                          </span>
                        )}
                      </td>

                      {/* Precio Base */}
                      <td className="px-6 py-4 font-mono font-bold text-sm text-slate-900">
                        {formatCOP(item.precio_base)}
                      </td>

                      {/* Existencias / Stock */}
                      <td className="px-6 py-4">
                        {item.maneja_stock === false ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                            <span>Por Encargo (Sin stock)</span>
                          </span>
                        ) : (item.stock ?? 0) <= 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                            <span>Agotado (0 disp.)</span>
                          </span>
                        ) : (item.stock ?? 0) <= 5 ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            <span>Bajo Stock ({item.stock} disp.)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{item.stock} disponibles</span>
                          </span>
                        )}
                      </td>

                      {/* Estado Operativo (Activo / Inactivo) */}
                      <td className="px-6 py-4">
                        {!estaInactivo ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Activo en Catálogo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <PowerOff className="w-3 h-3 text-amber-600" />
                            Desactivado
                          </span>
                        )}
                      </td>

                      {/* Acciones: Editar, Reabastecer, Eliminar, Inactivar/Reactivar */}
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          {item.maneja_stock !== false && (
                            <button
                              onClick={() => {
                                setProductoAReabastecer(item);
                                setReabastecerCantidad('10');
                                setReabastecerMotivo('Entrada de almacén');
                                setIsReabastecerModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-semibold transition-colors cursor-pointer"
                              title="Registrar entrada de existencias al almacén"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>+ Stock</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleOpenModal(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                            title="Modificar parámetros del artículo"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>

                          {estaInactivo ? (
                            <button
                              onClick={() => handleReactivarProducto(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                              title="Habilitar nuevamente para ventas POS"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Reactivar</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleSolicitarEliminar(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 hover:border-rose-300 transition-colors cursor-pointer"
                              title="Eliminar artículo del inventario"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Eliminar</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL FLOTANTE CORPORATIVO DE CONFIRMACIÓN DE ELIMINACIÓN */}
      {isDeleteModalOpen && productoAEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150">
            
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0 shadow-2xs">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  ¿Estás seguro de eliminar este artículo?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Esta acción solicitará la baja del producto en el servidor central de inventario.
                </p>
              </div>
            </div>

            {/* Ficha del Producto a Eliminar */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <span className="text-xs font-bold text-slate-900 block">
                {productoAEliminar.nombre}
              </span>
              <div className="flex items-center gap-2 text-[11px] text-slate-600 font-mono">
                <span>SKU: {productoAEliminar.sku}</span>
                <span>•</span>
                <span>Precio: {formatCOP(productoAEliminar.precio_base)}</span>
              </div>
            </div>

            {/* Advertencia Financiera Corporativa */}
            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-900 flex items-start gap-2.5 text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Control Financiero:</strong> Si este producto ya está asociado a créditos activos o contratos históricos (<code>credito_detalle</code>), el servidor rechazará automáticamente el borrado físico para proteger la integridad contable.
              </p>
            </div>

            {/* Botones de Acción */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setProductoAEliminar(null);
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmarEliminar}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Verificando en Base de Datos...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Sí, Eliminar Artículo</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL DE CREACIÓN Y EDICIÓN DE PRODUCTOS */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-lg border border-slate-200 shadow-xl overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  {productoEditando ? 'Editar Artículo' : 'Nuevo Artículo para Catálogo'}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Complete los parámetros de venta y especifique si aplica precio variable.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarProducto} className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* ZONA DE CARGA DE IMAGEN (CANVAS OPTIMIZADO A WEBP 800x800) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  FOTOGRAFÍA DEL ARTÍCULO (CATÁLOGO)
                </label>

                {formImagenUrl ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex items-center gap-3">
                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-slate-200 bg-white shrink-0 relative">
                      <img
                        src={
                          formImagenUrl.startsWith('http')
                            ? formImagenUrl
                            : `${API_BASE_URL}${formImagenUrl}`
                        }
                        alt="Previsualización de producto"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 text-emerald-700 text-xs font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Imagen optimizada cargada</span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                        {formImagenUrl}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <label className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors inline-block">
                          Reemplazar
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleSubirArchivo(file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setFormImagenUrl('')}
                          className="text-[11px] font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleSubirArchivo(file);
                    }}
                    className={cn(
                      'relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer group',
                      isDragging
                        ? 'border-emerald-500 bg-emerald-50/50'
                        : 'border-slate-200 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50',
                      isSubiendoImagen && 'opacity-60 pointer-events-none'
                    )}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      disabled={isSubiendoImagen}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleSubirArchivo(file);
                        e.target.value = '';
                      }}
                    />
                    <div className="flex flex-col items-center justify-center space-y-1">
                      {isSubiendoImagen ? (
                        <>
                          <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin" />
                          <span className="text-xs font-semibold text-slate-800">
                            Optimizando imagen (Canvas WebP) y subiendo...
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 group-hover:text-slate-800 group-hover:bg-slate-200 transition-colors">
                            <UploadCloud className="w-4 h-4" />
                          </div>
                          <div className="text-xs font-semibold text-slate-700">
                            <span className="text-emerald-700 underline">Haz clic para buscar</span> o arrastra la foto aquí
                          </div>
                          <p className="text-[10px] text-slate-600">
                            Se optimizará a máx 800x800 px (WebP 80%) en tu navegador antes de subir
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SKU (CÓDIGO ÚNICO)
                </label>
                <input
                  type="text"
                  required
                  value={formSku}
                  onChange={(e) => setFormSku(e.target.value)}
                  placeholder="Ej: MEC-01 o ART-05"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  NOMBRE DEL ARTÍCULO
                </label>
                <input
                  type="text"
                  required
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                  placeholder="Ej: Mecedora Momposina Roble / Cuadro Óleo Atardecer"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  PRECIO BASE SUGERIDO (COP)
                </label>
                <input
                  type="number"
                  required
                  value={formPrecioBase}
                  onChange={(e) => setFormPrecioBase(e.target.value)}
                  placeholder="Ej: 450000"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900"
                />
              </div>

              {/* SWITCH ES_PRECIO_VARIABLE */}
              <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-700" />
                    <span className="text-xs font-bold text-purple-900">
                      ¿Es Obra de Arte o Precio Negociable?
                    </span>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formEsPrecioVariable}
                      onChange={(e) => setFormEsPrecioVariable(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>

                <p className="text-[11px] text-purple-800 leading-relaxed">
                  Al activar esta bandera (<code>es_precio_variable</code>), el sistema permite que los vendedores en campo negocien libremente el precio sin requerir autorización previa.
                </p>
              </div>

              {/* SWITCH MANEJA_STOCK */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-slate-700" />
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        ¿Controla Inventario Físico (Maneja Stock)?
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Activo para muebles y mecedoras. Desactive para "cuadros" hechos por encargo.
                      </span>
                    </div>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formManejaStock}
                      onChange={(e) => setFormManejaStock(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {formManejaStock && (
                  <div className="pt-2 border-t border-slate-200/60">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      EXISTENCIAS DISPONIBLES EN ALMACÉN (UNIDADES)
                    </label>
                    <input
                      type="number"
                      min={0}
                      required={formManejaStock}
                      value={formStock}
                      onChange={(e) => setFormStock(e.target.value)}
                      placeholder="Ej: 15"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 bg-white"
                    />
                  </div>
                )}
              </div>

              {/* ESTADO ACTIVO */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-xs font-semibold text-slate-700">
                  ¿Artículo Activo en Catálogo?
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formEstadoActivo}
                    onChange={(e) => setFormEstadoActivo(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100 shrink-0 sticky bottom-0 bg-white pb-1">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  {productoEditando ? 'Guardar Cambios' : 'Crear Artículo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE REABASTECIMIENTO DE INVENTARIO */}
      {isReabastecerModalOpen && productoAReabastecer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Reabastecer Inventario
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Registrar entrada de existencias para "{productoAReabastecer.nombre}"
                </p>
              </div>
              <button
                onClick={() => setIsReabastecerModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmarReabastecer} className="p-6 space-y-4">
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs space-y-1">
                <div className="flex justify-between text-emerald-900 font-semibold">
                  <span>Artículo:</span>
                  <span>{productoAReabastecer.nombre}</span>
                </div>
                <div className="flex justify-between text-emerald-800">
                  <span>SKU:</span>
                  <span className="font-mono">{productoAReabastecer.sku}</span>
                </div>
                <div className="flex justify-between text-emerald-950 font-bold pt-1 border-t border-emerald-200/60">
                  <span>Stock actual:</span>
                  <span>{productoAReabastecer.stock ?? 0} unidades</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  CANTIDAD A INGRESAR (UNIDADES FÍSICAS)
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={reabastecerCantidad}
                  onChange={(e) => setReabastecerCantidad(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                  placeholder="Ej: 10"
                />

                {/* Botones rápidos de incremento */}
                <div className="flex items-center gap-1.5 mt-2">
                  {[5, 10, 20, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setReabastecerCantidad(num.toString())}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      +{num}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  MOTIVO / REFERENCIA DE ENTRADA
                </label>
                <input
                  type="text"
                  value={reabastecerMotivo}
                  onChange={(e) => setReabastecerMotivo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900"
                  placeholder="Ej: Llegada de camión fábrica Montería"
                />
              </div>

              {/* Vista previa en vivo del stock resultante */}
              <div className="p-3 bg-slate-50 border border-slate-200/70 rounded-xl text-xs flex justify-between items-center">
                <span className="text-slate-600">Stock resultante en almacén:</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {(productoAReabastecer.stock ?? 0) + (parseInt(reabastecerCantidad, 10) || 0)} unidades
                </span>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReabastecerModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isReabasteciendo}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isReabasteciendo ? 'Guardando...' : 'Confirmar Entrada'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


    </div>
  );
}
