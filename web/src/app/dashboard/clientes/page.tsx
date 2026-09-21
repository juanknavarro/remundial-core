'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  UserCheck,
  Plus,
  Search,
  Filter,
  Phone,
  MapPin,
  CreditCard,
  Edit2,
  X,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Building,
  Calendar,
  DollarSign,
  TrendingUp,
  FileText,
  Clock,
  ChevronRight,
  ShieldCheck,
  ExternalLink,
  Trash2,
  Users,
} from 'lucide-react';
import { cn, formatCOP } from '@/lib/utils';
import { api } from '@/lib/api';

export interface ClienteItem {
  id: string;
  cedula: string;
  nombres: string;
  telefono: string | null;
  direccion: string;
  barrio: string | null;
  ciudad: string;
  creado_en?: string;
  actualizado_en?: string;
}

export interface CreditoResumen {
  id_contrato: string;
  monto_financiado: number;
  saldo_pendiente: number;
  valor_cuota: number;
  numero_cuotas: number;
  tipo_pago: string;
  estado: string;
  cuota_inicial: number;
  creado_en: string;
  detalles?: {
    id: string;
    producto?: {
      nombre: string;
      sku: string;
    };
    cantidad: number;
    valor_unitario_acordado: number;
    subtotal: number;
  }[];
}

export default function GestionClientesPage() {
  const [clientes, setClientes] = useState<ClienteItem[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroCiudad, setFiltroCiudad] = useState('todas');
  const [isLoading, setIsLoading] = useState(false);
  const [mensajeAlerta, setMensajeAlerta] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);

  // Modales
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [clienteEditando, setClienteEditando] = useState<ClienteItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form Fields
  const [formCedula, setFormCedula] = useState('');
  const [formNombres, setFormNombres] = useState('');
  const [formTelefono, setFormTelefono] = useState('');
  const [formDireccion, setFormDireccion] = useState('');
  const [formBarrio, setFormBarrio] = useState('');
  const [formCiudad, setFormCiudad] = useState('Montería');

  // Modal Historial Crediticio
  const [isHistorialModalOpen, setIsHistorialModalOpen] = useState(false);
  const [clienteHistorial, setClienteHistorial] = useState<ClienteItem | null>(null);
  const [creditosCliente, setCreditosCliente] = useState<CreditoResumen[]>([]);
  const [garantiasCliente, setGarantiasCliente] = useState<{
    codeudor?: { nombre: string; cedula?: string | null; telefono?: string | null; direccion?: string | null } | null;
    referencia_familiar?: { nombre: string; telefono?: string | null; parentesco?: string | null; direccion?: string | null } | null;
  } | null>(null);
  const [isLoadingHistorial, setIsLoadingHistorial] = useState(false);

  // Modal Eliminación de Cliente
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [clienteAEliminar, setClienteAEliminar] = useState<ClienteItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleAbrirModalEliminar = (cliente: ClienteItem) => {
    setClienteAEliminar(cliente);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmarEliminar = async () => {
    if (!clienteAEliminar) return;
    setIsDeleting(true);
    setMensajeAlerta(null);

    try {
      await api.delete(`/clientes/${clienteAEliminar.id}`);
      setClientes((prev) => prev.filter((c) => c.id !== clienteAEliminar.id));
      setMensajeAlerta({
        tipo: 'exito',
        texto: `El cliente "${clienteAEliminar.nombres}" ha sido eliminado exitosamente del directorio.`,
      });
      setIsDeleteModalOpen(false);
      setClienteAEliminar(null);
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail;
      setMensajeAlerta({
        tipo: 'error',
        texto: detail || 'No fue posible eliminar el cliente. Verifique que no posea créditos o contratos asociados.',
      });
      setIsDeleteModalOpen(false);
      setClienteAEliminar(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Cargar clientes desde FastAPI
  const cargarClientes = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/clientes');
      if (Array.isArray(res.data)) {
        setClientes(res.data);
      }
    } catch {
      // Error de red o sin conexión
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    cargarClientes();
  }, []);

  // Abrir modal de creación/edición
  const handleOpenFormModal = (cliente?: ClienteItem) => {
    if (cliente) {
      setClienteEditando(cliente);
      setFormCedula(cliente.cedula);
      setFormNombres(cliente.nombres);
      setFormTelefono(cliente.telefono || '');
      setFormDireccion(cliente.direccion);
      setFormBarrio(cliente.barrio || '');
      setFormCiudad(cliente.ciudad);
    } else {
      setClienteEditando(null);
      setFormCedula('');
      setFormNombres('');
      setFormTelefono('');
      setFormDireccion('');
      setFormBarrio('');
      setFormCiudad('Montería');
    }
    setMensajeAlerta(null);
    setIsFormModalOpen(true);
  };

  // Guardar cliente (POST o PUT)
  const handleGuardarCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMensajeAlerta(null);

    const payload = {
      cedula: formCedula.trim(),
      nombres: formNombres.trim(),
      telefono: formTelefono.trim() || null,
      direccion: formDireccion.trim(),
      barrio: formBarrio.trim() || null,
      ciudad: formCiudad.trim() || 'Montería',
    };

    try {
      if (clienteEditando) {
        // Actualizar
        const res = await api.put(`/clientes/${clienteEditando.id}`, payload);
        const actualizado = res.data;
        setClientes((prev) =>
          prev.map((c) => (c.id === clienteEditando.id ? { ...c, ...actualizado } : c))
        );
        setMensajeAlerta({ tipo: 'exito', texto: `Cliente "${payload.nombres}" actualizado exitosamente.` });
      } else {
        // Crear
        const res = await api.post('/clientes', payload);
        const nuevoCliente = res.data;
        setClientes((prev) => [nuevoCliente, ...prev]);
        setMensajeAlerta({ tipo: 'exito', texto: `Cliente "${payload.nombres}" registrado exitosamente.` });
      }
      setIsFormModalOpen(false);
    } catch (err: any) {
      console.error(err);
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      if (status === 409) {
        setMensajeAlerta({ tipo: 'error', texto: `Conflicto: Ya existe un cliente registrado con la cédula ${payload.cedula}.` });
      } else {
        setMensajeAlerta({
          tipo: 'error',
          texto: detail || 'Ocurrió un error al procesar la solicitud del cliente.',
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Ver historial crediticio y garantías
  const handleVerHistorial = async (cliente: ClienteItem) => {
    setClienteHistorial(cliente);
    setIsHistorialModalOpen(true);
    setIsLoadingHistorial(true);
    setCreditosCliente([]);
    setGarantiasCliente(null);

    try {
      const [resCreditos, resGarantias] = await Promise.all([
        api.get(`/creditos?cliente_id=${cliente.id}`).catch(() => ({ data: [] })),
        api.get(`/clientes/${cliente.id}/garantias`).catch(() => ({ data: null })),
      ]);
      if (Array.isArray(resCreditos.data)) {
        setCreditosCliente(resCreditos.data);
      }
      if (resGarantias.data) {
        setGarantiasCliente(resGarantias.data);
      }
    } catch {
      setCreditosCliente([]);
    } finally {
      setIsLoadingHistorial(false);
    }
  };

  // Filtro en memoria
  const clientesFiltrados = clientes.filter((c) => {
    const query = busqueda.toLowerCase();
    const matchBusqueda =
      c.nombres.toLowerCase().includes(query) ||
      c.cedula.toLowerCase().includes(query) ||
      (c.telefono && c.telefono.includes(query)) ||
      (c.barrio && c.barrio.toLowerCase().includes(query));

    const matchCiudad =
      filtroCiudad === 'todas' ||
      c.ciudad.toLowerCase() === filtroCiudad.toLowerCase();

    return matchBusqueda && matchCiudad;
  });

  // Ciudades únicas para selector
  const ciudadesUnicas = Array.from(new Set(clientes.map((c) => c.ciudad)));

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* HEADER PRINCIPAL */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold shadow-sm">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
                Directorio & Gestión de Clientes
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">
                Base central de clientes titulares, domicilios verificados e historial crediticio
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={cargarClientes}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Refrescar lista"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </button>

          <button
            type="button"
            onClick={() => handleOpenFormModal()}
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Cliente</span>
          </button>
        </div>
      </div>

      {/* MENSAJES DE ALERTA FLOTANTES O EN PÁGINA */}
      {mensajeAlerta && (
        <div
          className={cn(
            'p-4 rounded-2xl border flex items-center justify-between text-xs sm:text-sm shadow-xs animate-in slide-in-from-top-2',
            mensajeAlerta.tipo === 'exito'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          )}
        >
          <div className="flex items-center gap-3">
            {mensajeAlerta.tipo === 'exito' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{mensajeAlerta.texto}</span>
          </div>
          <button
            onClick={() => setMensajeAlerta(null)}
            className="p-1 text-slate-600 hover:text-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TARJETAS DE MÉTRICAS RÁPIDAS (KPIS) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
            Total Clientes Registrados
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {clientes.length}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              Directorio Activo
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
            Cobertura Geográfica
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {ciudadesUnicas.length}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
              Municipios
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
            Canal de Originación
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-emerald-700">
              POS Web + Móvil
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
              En Terreno
            </span>
          </div>
        </div>
      </div>

      {/* BARRA DE FILTROS Y BÚSQUEDA */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cédula, nombre, teléfono o barrio..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-600 shrink-0" />
          <select
            value={filtroCiudad}
            onChange={(e) => setFiltroCiudad(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm font-medium text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-slate-900 bg-white"
          >
            <option value="todas">Todas las Ciudades</option>
            {ciudadesUnicas.map((ciudad) => (
              <option key={ciudad} value={ciudad}>
                {ciudad}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* TABLA CORPORATIVA DE CLIENTES */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-6">Cliente Titular</th>
                <th className="py-3.5 px-6">Cédula</th>
                <th className="py-3.5 px-6">Contacto</th>
                <th className="py-3.5 px-6">Ubicación & Domicilio</th>
                <th className="py-3.5 px-6 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-sm text-slate-700">
              {clientesFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-600">
                    <UserCheck className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="font-semibold text-slate-800">No se encontraron clientes</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Intenta con otro término de búsqueda o crea un nuevo cliente.
                    </p>
                  </td>
                </tr>
              ) : (
                clientesFiltrados.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60 transition-colors group">
                    
                    {/* Cliente / Avatar */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                          {c.nombres
                            .split(' ')
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join('')
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 group-hover:text-slate-950">
                            {c.nombres}
                          </p>
                          <span className="text-[11px] text-slate-600 block">
                            Titular de Cartera
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Cédula */}
                    <td className="py-4 px-6 font-mono font-medium text-slate-800">
                      {c.cedula}
                    </td>

                    {/* Contacto */}
                    <td className="py-4 px-6">
                      {c.telefono ? (
                        <div className="flex items-center gap-1.5 font-mono text-slate-700">
                          <Phone className="w-3.5 h-3.5 text-slate-600" />
                          <span>{c.telefono}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600 text-xs italic">Sin registrar</span>
                      )}
                    </td>

                    {/* Domicilio */}
                    <td className="py-4 px-6">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-slate-800 font-medium">
                          <MapPin className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                          <span>{c.direccion}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          {c.barrio && (
                            <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-medium">
                              B/ {c.barrio}
                            </span>
                          )}
                          <span>• {c.ciudad}</span>
                        </div>
                      </div>
                    </td>

                    {/* Acciones */}
                    <td className="py-4 px-6 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleVerHistorial(c)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
                          title="Ver historial de créditos"
                        >
                          <CreditCard className="w-3.5 h-3.5 text-slate-600" />
                          <span>Historial</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenFormModal(c)}
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
                          title="Editar información"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAbrirModalEliminar(c)}
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer"
                          title="Eliminar cliente"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL CREAR / EDITAR CLIENTE */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg border border-slate-200 shadow-2xl p-6 sm:p-7 space-y-6 animate-in zoom-in-95 duration-150">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold shadow-xs">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {clienteEditando ? 'Actualizar Datos de Cliente' : 'Registrar Nuevo Cliente'}
                  </h3>
                  <p className="text-xs text-slate-600">
                    Información de identificación y domicilio para originación y cobro
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                className="p-1 text-slate-600 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarCliente} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Cédula */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    CÉDULA DE CIUDADANÍA *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: 1001234567"
                    value={formCedula}
                    onChange={(e) => setFormCedula(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
                  />
                </div>

                {/* Teléfono */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    TELÉFONO DE CONTACTO
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 312 456 7890"
                    value={formTelefono}
                    onChange={(e) => setFormTelefono(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
                  />
                </div>

                {/* Nombres */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    NOMBRES Y APELLIDOS COMPLETOS *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Carlos Alberto Gómez Mejía"
                    value={formNombres}
                    onChange={(e) => setFormNombres(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
                  />
                </div>

                {/* Dirección */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    DIRECCIÓN DEL DOMICILIO *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Calle 24 # 5-30"
                    value={formDireccion}
                    onChange={(e) => setFormDireccion(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
                  />
                </div>

                {/* Barrio */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    BARRIO O SECTOR
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: La Granja"
                    value={formBarrio}
                    onChange={(e) => setFormBarrio(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
                  />
                </div>

                {/* Ciudad */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    CIUDAD / MUNICIPIO *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Montería"
                    value={formCiudad}
                    onChange={(e) => setFormCiudad(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
                  />
                </div>

              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center gap-2"
                >
                  {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{clienteEditando ? 'Guardar Cambios' : 'Registrar Cliente'}</span>
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* MODAL / DRAWER DE HISTORIAL CREDITICIO */}
      {isHistorialModalOpen && clienteHistorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-2xl border border-slate-200 shadow-2xl p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150">
            
            {/* Header del Historial */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center font-bold shadow-xs">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Historial de Cartera del Cliente
                  </h3>
                  <p className="text-xs text-slate-600 flex items-center gap-2 mt-0.5">
                    <span className="font-semibold text-slate-800">{clienteHistorial.nombres}</span>
                    <span>•</span>
                    <span className="font-mono">C.C. {clienteHistorial.cedula}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHistorialModalOpen(false)}
                className="p-1 text-slate-600 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resumen Financiero del Cliente */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider block">
                  Total Contratos
                </span>
                <span className="text-lg font-black text-slate-900">
                  {creditosCliente.length}
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
                <span className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider block">
                  Monto Financiado Acumulado
                </span>
                <span className="text-lg font-black text-emerald-800 font-mono">
                  {formatCOP(
                    creditosCliente.reduce((acc, cr) => acc + Number(cr.monto_financiado || 0), 0)
                  )}
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900 text-white sm:col-span-1 col-span-2">
                <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider block">
                  Saldo Pendiente Activo
                </span>
                <span className="text-lg font-black font-mono">
                  {formatCOP(
                    creditosCliente.reduce((acc, cr) => acc + Number(cr.saldo_pendiente || 0), 0)
                  )}
                </span>
              </div>
            </div>

            {/* SECCIÓN: GARANTÍAS Y RESPALDO DEL CLIENTE */}
            <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/80 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Garantías y Respaldo
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Datos de respaldo patrimonial para estudio crediticio y cobranza
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Codeudor */}
                <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                      Codeudor Solidario
                    </span>
                    {garantiasCliente?.codeudor?.nombre ? (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        Registrado
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                        Sin registrar
                      </span>
                    )}
                  </div>

                  {garantiasCliente?.codeudor?.nombre ? (
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Nombre:</span>
                        <span className="font-bold text-slate-900 text-right">{garantiasCliente.codeudor.nombre}</span>
                      </div>
                      {garantiasCliente.codeudor.cedula && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Cédula:</span>
                          <span className="font-mono text-slate-800">{garantiasCliente.codeudor.cedula}</span>
                        </div>
                      )}
                      {garantiasCliente.codeudor.telefono && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">Teléfono:</span>
                          <a
                            href={`tel:${garantiasCliente.codeudor.telefono.replace(/\s+/g, '')}`}
                            className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold hover:underline bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200"
                            title="Llamar al codeudor"
                          >
                            <Phone className="w-3 h-3" />
                            <span>{garantiasCliente.codeudor.telefono}</span>
                          </a>
                        </div>
                      )}
                      {garantiasCliente.codeudor.direccion && (
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-slate-500 shrink-0">Dirección:</span>
                          <span className="text-slate-800 text-right">{garantiasCliente.codeudor.direccion}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic py-1">
                      No se han registrado datos de codeudor para este cliente.
                    </p>
                  )}
                </div>

                {/* Referencia Familiar */}
                <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-blue-600" />
                      Referencia Familiar
                    </span>
                    {garantiasCliente?.referencia_familiar?.nombre ? (
                      <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                        {garantiasCliente.referencia_familiar.parentesco || 'Familiar'}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                        Sin registrar
                      </span>
                    )}
                  </div>

                  {garantiasCliente?.referencia_familiar?.nombre ? (
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Nombre:</span>
                        <span className="font-bold text-slate-900 text-right">{garantiasCliente.referencia_familiar.nombre}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Parentesco:</span>
                        <span className="font-medium text-slate-800">{garantiasCliente.referencia_familiar.parentesco || 'Familiar'}</span>
                      </div>
                      {garantiasCliente.referencia_familiar.telefono && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">Teléfono:</span>
                          <a
                            href={`tel:${garantiasCliente.referencia_familiar.telefono.replace(/\s+/g, '')}`}
                            className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-800 font-bold hover:underline bg-blue-50 px-2 py-0.5 rounded border border-blue-200"
                            title="Llamar a la referencia"
                          >
                            <Phone className="w-3 h-3" />
                            <span>{garantiasCliente.referencia_familiar.telefono}</span>
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic py-1">
                      No se han registrado referencias familiares para este cliente.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Listado de Créditos */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Detalle de Operaciones y Contratos
              </h4>

              {isLoadingHistorial ? (
                <div className="py-12 text-center text-slate-600">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-600" />
                  <p className="text-xs">Consultando base de cartera en tiempo real...</p>
                </div>
              ) : creditosCliente.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-slate-200 text-center text-slate-600 space-y-2">
                  <FileText className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-800">
                    Este cliente aún no registra contratos de crédito en el sistema.
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Puedes originar su primera venta desde el Punto de Venta (POS).
                  </p>
                  <div className="pt-2">
                    <Link
                      href="/dashboard/pos"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Originar Venta en POS</span>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {creditosCliente.map((cr) => (
                    <div
                      key={cr.id_contrato}
                      className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-all bg-white shadow-2xs space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900">
                            #{cr.id_contrato.slice(0, 8).toUpperCase()}
                          </span>
                          <span className="text-xs text-slate-600">
                            {new Date(cr.creado_en).toLocaleDateString('es-CO')}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider',
                            cr.estado === 'activo'
                              ? 'bg-emerald-100 text-emerald-800'
                              : cr.estado === 'pendiente'
                              ? 'bg-amber-100 text-amber-800'
                              : cr.estado === 'finalizado'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-rose-100 text-rose-800'
                          )}
                        >
                          {cr.estado}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs border-t border-slate-100 pt-3">
                        <div>
                          <span className="text-slate-600 block text-[11px]">Monto Financiado</span>
                          <span className="font-bold text-slate-900 font-mono">
                            {formatCOP(cr.monto_financiado)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-600 block text-[11px]">Saldo Pendiente</span>
                          <span className="font-bold text-rose-600 font-mono">
                            {formatCOP(cr.saldo_pendiente)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-600 block text-[11px]">Plan de Pagos</span>
                          <span className="font-medium text-slate-800 capitalize">
                            {cr.numero_cuotas || 0} cuotas ({cr.tipo_pago})
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-600 block text-[11px]">Valor Cuota</span>
                          <span className="font-bold text-slate-900 font-mono">
                            {formatCOP(cr.valor_cuota)}
                          </span>
                        </div>
                      </div>

                      {/* Artículos adquiridos en este crédito */}
                      {cr.detalles && cr.detalles.length > 0 && (
                        <div className="bg-slate-50/70 rounded-lg p-2.5 border border-slate-100 text-xs space-y-1">
                          <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider block">
                            Artículos en el Contrato:
                          </span>
                          <div className="space-y-0.5">
                            {cr.detalles.map((det) => (
                              <div key={det.id} className="flex items-center justify-between text-slate-700">
                                <span>
                                  {det.cantidad}x {det.producto?.nombre || 'Artículo de Cartera'}
                                </span>
                                <span className="font-mono font-medium text-slate-800">
                                  {formatCOP(det.subtotal)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsHistorialModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 transition-colors cursor-pointer"
              >
                Cerrar Historial
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL CORPORATIVO DE CONFIRMACIÓN DE ELIMINACIÓN */}
      {isDeleteModalOpen && clienteAEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-2xl p-6 sm:p-7 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0 shadow-2xs">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  ¿Estás seguro de eliminar este cliente?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Estás a punto de dar de baja al cliente{' '}
                  <strong className="text-slate-800 font-semibold">{clienteAEliminar.nombres}</strong> con C.C.{' '}
                  <span className="font-mono font-semibold text-slate-800">{clienteAEliminar.cedula}</span>.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 text-amber-900 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Por seguridad financiera, el sistema rechazará la eliminación si el cliente posee contratos de crédito activos o históricos en cartera.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setClienteAEliminar(null);
                }}
                disabled={isDeleting}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarEliminar}
                disabled={isDeleting}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center gap-2"
              >
                {isDeleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isDeleting ? 'Eliminando...' : 'Sí, Eliminar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
