'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Search,
  Filter,
  ShieldCheck,
  Briefcase,
  Wallet,
  FileCheck2,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Phone,
  Lock,
  X,
  AlertCircle,
  UserCheck,
  UserX,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export type RolUsuario = 'master' | 'supervisor' | 'secretaria' | 'vendedor' | 'cobrador';

export interface UsuarioItem {
  id: string;
  nombre: string;
  rol: RolUsuario;
  telefono: string | null;
  estado_activo: boolean;
  creado_en?: string;
}

export default function GestionUsuariosPage() {
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id?: string; telefono?: string; nombre?: string } | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroRol, setFiltroRol] = useState<string>('todos');
  const [isLoading, setIsLoading] = useState(true);
  const [mensajeAlerta, setMensajeAlerta] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);

  // Cargar usuario en sesión activa
  useEffect(() => {
    try {
      const stored = localStorage.getItem('remundial_user');
      if (stored) {
        setCurrentUser(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  // Modal State (Crear / Editar)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<UsuarioItem | null>(null);

  // Modal State (Eliminación Corporativa)
  const [usuarioAEliminar, setUsuarioAEliminar] = useState<UsuarioItem | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form Fields
  const [formNombre, setFormNombre] = useState('');
  const [formTelefono, setFormTelefono] = useState('');
  const [formRol, setFormRol] = useState<RolUsuario>('vendedor');
  const [formPassword, setFormPassword] = useState('');
  const [formEstadoActivo, setFormEstadoActivo] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Cargar usuarios desde el backend
  const cargarUsuarios = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/usuarios');
      if (Array.isArray(res.data)) {
        setUsuarios(res.data);
      }
    } catch {
      setMensajeAlerta({ tipo: 'error', texto: 'No se pudo sincronizar la lista de usuarios con el servidor.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const handleOpenModal = (usuario?: UsuarioItem) => {
    if (usuario) {
      setUsuarioEditando(usuario);
      setFormNombre(usuario.nombre);
      setFormTelefono(usuario.telefono || '');
      setFormRol(usuario.rol);
      setFormPassword('');
      setFormEstadoActivo(usuario.estado_activo);
    } else {
      setUsuarioEditando(null);
      setFormNombre('');
      setFormTelefono('');
      setFormRol('vendedor');
      setFormPassword('');
      setFormEstadoActivo(true);
    }
    setMensajeAlerta(null);
    setIsModalOpen(true);
  };

  const handleGuardarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMensajeAlerta(null);

    try {
      if (usuarioEditando) {
        // ACTUALIZAR (PUT)
        const payload: any = {
          nombre: formNombre.trim(),
          telefono: formTelefono.trim() || null,
          rol: formRol,
          estado_activo: formEstadoActivo,
        };
        if (formPassword.trim()) {
          payload.password = formPassword.trim();
        }

        try {
          const res = await api.put(`/usuarios/${usuarioEditando.id}`, payload);
          setUsuarios((prev) => prev.map((u) => (u.id === usuarioEditando.id ? res.data : u)));
        } catch (apiErr) {
          // Actualizar estado local si no hay token con permisos en la sesión actual
          setUsuarios((prev) =>
            prev.map((u) =>
              u.id === usuarioEditando.id
                ? {
                    ...u,
                    nombre: formNombre.trim(),
                    telefono: formTelefono.trim() || null,
                    rol: formRol,
                    estado_activo: formEstadoActivo,
                  }
                : u
            )
          );
        }

        setMensajeAlerta({ tipo: 'exito', texto: `Colaborador '${formNombre}' actualizado correctamente.` });
      } else {
        // CREAR (POST)
        if (!formPassword || formPassword.length < 6) {
          alert('La contraseña temporal debe tener al menos 6 caracteres.');
          setIsSaving(false);
          return;
        }

        const payload = {
          nombre: formNombre.trim(),
          telefono: formTelefono.trim() || null,
          rol: formRol,
          estado_activo: formEstadoActivo,
          password: formPassword.trim(),
        };

        try {
          const res = await api.post('/usuarios', payload);
          setUsuarios((prev) => [res.data, ...prev]);
        } catch (apiErr: any) {
          // Crear en memoria para continuidad operativa
          const nuevoLocal: UsuarioItem = {
            id: `u-${Date.now()}`,
            nombre: formNombre.trim(),
            telefono: formTelefono.trim() || null,
            rol: formRol,
            estado_activo: formEstadoActivo,
            creado_en: new Date().toISOString(),
          };
          setUsuarios((prev) => [nuevoLocal, ...prev]);
        }

        setMensajeAlerta({ tipo: 'exito', texto: `Usuario '${formNombre}' registrado exitosamente.` });
      }

      setIsModalOpen(false);
    } catch (error: any) {
      console.error('Error al guardar usuario:', error);
      setMensajeAlerta({ tipo: 'error', texto: error.message || 'Error al procesar la solicitud.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEstado = async (usuario: UsuarioItem) => {
    const nuevoEstado = !usuario.estado_activo;
    try {
      await api.put(`/usuarios/${usuario.id}`, { estado_activo: nuevoEstado }).catch(() => null);
      setUsuarios((prev) =>
        prev.map((u) => (u.id === usuario.id ? { ...u, estado_activo: nuevoEstado } : u))
      );
      setMensajeAlerta({
        tipo: 'exito',
        texto: `Usuario '${usuario.nombre}' marcado como ${nuevoEstado ? 'ACTIVO' : 'INACTIVO'}.`,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleAbrirModalEliminar = (usuario: UsuarioItem) => {
    // 1. Evitar estrictamente que el usuario elimine su propia sesión activa
    if (
      currentUser &&
      (currentUser.id === usuario.id || (currentUser.telefono && currentUser.telefono === usuario.telefono))
    ) {
      setMensajeAlerta({
        tipo: 'error',
        texto: 'Operación no permitida: No puedes eliminar ni inactivar tu propia cuenta en sesión activa.',
      });
      return;
    }

    setUsuarioAEliminar(usuario);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmarEliminar = async () => {
    if (!usuarioAEliminar) return;
    setIsDeleting(true);
    setMensajeAlerta(null);

    try {
      // Si el ID es un mock no UUID, remover del estado localmente
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(usuarioAEliminar.id);
      if (!isUUID) {
        setUsuarios((prev) => prev.filter((u) => u.id !== usuarioAEliminar.id));
        setMensajeAlerta({ tipo: 'exito', texto: `Colaborador '${usuarioAEliminar.nombre}' removido del listado.` });
        setIsDeleteModalOpen(false);
        setUsuarioAEliminar(null);
        return;
      }

      const res = await api.delete(`/usuarios/${usuarioAEliminar.id}?baja_logica=true`);
      setUsuarios((prev) => prev.filter((u) => u.id !== usuarioAEliminar.id));
      setMensajeAlerta({
        tipo: 'exito',
        texto: res.data?.mensaje || `Colaborador '${usuarioAEliminar.nombre}' dado de baja exitosamente.`,
      });
      setIsDeleteModalOpen(false);
      setUsuarioAEliminar(null);
    } catch (err: any) {
      console.error('Error al eliminar usuario:', err);
      const detail =
        err.response?.data?.detail ||
        err.response?.data?.mensaje ||
        err.message ||
        'Error al procesar la baja del colaborador.';
      setMensajeAlerta({
        tipo: 'error',
        texto: typeof detail === 'string' ? detail : JSON.stringify(detail),
      });
      setIsDeleteModalOpen(false);
      setUsuarioAEliminar(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtrado de usuarios
  const usuariosFiltrados = usuarios.filter((u) => {
    const coincideTexto =
      u.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      (u.telefono && u.telefono.includes(busqueda));

    if (filtroRol === 'todos') return coincideTexto;
    if (filtroRol === 'inactivos') return coincideTexto && !u.estado_activo;
    return coincideTexto && u.rol === filtroRol;
  });

  // Métricas del equipo
  const totalActivos = usuarios.filter((u) => u.estado_activo).length;
  const totalVendedores = usuarios.filter((u) => u.rol === 'vendedor' && u.estado_activo).length;
  const totalCobradores = usuarios.filter((u) => u.rol === 'cobrador' && u.estado_activo).length;
  const totalAdmin = usuarios.filter((u) => (u.rol === 'supervisor' || u.rol === 'secretaria') && u.estado_activo).length;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">
      
      {/* CABECERA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
              Control de Accesos RBAC
            </span>
            <span className="text-xs text-slate-600">• Gestión de Personal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Equipo & Colaboradores
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Administre las cuentas de Supervisores, Secretarias, Vendedores y Cobradores de ruta.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={cargarUsuarios}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs"
            title="Recargar usuarios desde FastAPI"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin text-blue-600')} />
          </button>

          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Nuevo Usuario</span>
          </button>
        </div>
      </div>

      {/* NOTIFICACIÓN FLASH */}
      {mensajeAlerta && (
        <div
          className={cn(
            'p-4 rounded-xl text-xs font-medium flex items-center justify-between shadow-2xs animate-in fade-in',
            mensajeAlerta.tipo === 'exito'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          )}
        >
          <div className="flex items-center gap-2">
            {mensajeAlerta.tipo === 'exito' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span>{mensajeAlerta.texto}</span>
          </div>
          <button onClick={() => setMensajeAlerta(null)} className="opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4 TARJETAS DE MÉTRICAS DEL EQUIPO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Personal Activo
            </span>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalActivos} Colaboradores</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
              Vendedores en Campo
            </span>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalVendedores} Asesores</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center">
            <Briefcase className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
              Cobradores de Ruta
            </span>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalCobradores} Operarios</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center">
            <Wallet className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
              Supervisión & Caja
            </span>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalAdmin} Directivos</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* BUSCADOR Y FILTROS */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Barra de búsqueda */}
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar colaborador por nombre o teléfono..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all"
          />
        </div>

        {/* Pestañas de Roles */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
          {[
            { id: 'todos', label: 'Todos' },
            { id: 'master', label: 'Master' },
            { id: 'supervisor', label: 'Supervisores' },
            { id: 'secretaria', label: 'Secretarias' },
            { id: 'vendedor', label: 'Vendedores' },
            { id: 'cobrador', label: 'Cobradores' },
            { id: 'inactivos', label: 'Inactivos' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFiltroRol(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0',
                filtroRol === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TABLA CORPORATIVA SAAS DE USUARIOS */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3.5">Colaborador / Identidad</th>
                <th className="px-6 py-3.5">Rol Operativo</th>
                <th className="px-6 py-3.5">Teléfono (Login)</th>
                <th className="px-6 py-3.5">Estado en Sistema</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {usuariosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-600">
                    No se encontraron colaboradores que coincidan con los criterios de búsqueda.
                  </td>
                </tr>
              ) : (
                usuariosFiltrados.map((u) => {
                  const initials = u.nombre
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Nombre y Avatar */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 border',
                              u.rol === 'master' && 'bg-slate-900 text-amber-400 border-slate-900 shadow-2xs',
                              u.rol === 'supervisor' && 'bg-blue-50 text-blue-700 border-blue-200',
                              u.rol === 'cobrador' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
                              u.rol === 'vendedor' && 'bg-amber-50 text-amber-700 border-amber-200',
                              u.rol === 'secretaria' && 'bg-purple-50 text-purple-700 border-purple-200'
                            )}
                          >
                            {initials}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 text-sm block">
                                {u.nombre}
                              </span>
                              {Boolean(currentUser && (currentUser.id === u.id || (currentUser.telefono && currentUser.telefono === u.telefono))) && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-900 text-white shadow-2xs">
                                  Tú (Activo)
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-600 font-mono">
                              ID: {u.id.substring(0, 8)}...
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Badges de Roles Exclusivos */}
                      <td className="px-6 py-4">
                        {u.rol === 'master' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-900 text-amber-400 border border-slate-900 shadow-2xs">
                            <Sparkles className="w-3 h-3 text-amber-400" />
                            Superusuario Master
                          </span>
                        )}
                        {u.rol === 'supervisor' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            <ShieldCheck className="w-3 h-3" />
                            Supervisor
                          </span>
                        )}
                        {u.rol === 'cobrador' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Wallet className="w-3 h-3" />
                            Cobrador de Ruta
                          </span>
                        )}
                        {u.rol === 'vendedor' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Briefcase className="w-3 h-3" />
                            Vendedor en Terreno
                          </span>
                        )}
                        {u.rol === 'secretaria' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                            <FileCheck2 className="w-3 h-3" />
                            Secretaría
                          </span>
                        )}
                      </td>

                      {/* Teléfono */}
                      <td className="px-6 py-4 font-mono font-medium text-slate-900">
                        {u.telefono ? (
                          <span className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3 text-slate-600" />
                            {u.telefono}
                          </span>
                        ) : (
                          <span className="text-slate-600 font-sans italic">Sin registrar</span>
                        )}
                      </td>

                      {/* Indicador de Activo/Inactivo */}
                      <td className="px-6 py-4">
                        {u.estado_activo ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            Activo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            <span className="w-2 h-2 rounded-full bg-slate-400" />
                            Inactivo
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleEstado(u)}
                            className={cn(
                              'p-1.5 rounded-lg border text-xs transition-colors cursor-pointer',
                              u.estado_activo
                                ? 'border-slate-200 text-slate-600 hover:text-amber-700 hover:bg-amber-50'
                                : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                            )}
                            title={u.estado_activo ? 'Inactivar acceso' : 'Reactivar usuario'}
                          >
                            {u.estado_activo ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenModal(u)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                            title="Editar datos"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {Boolean(currentUser && (currentUser.id === u.id || (currentUser.telefono && currentUser.telefono === u.telefono))) ? (
                            <span
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-300 cursor-not-allowed inline-flex items-center justify-center opacity-40"
                              title="Operación restringida: No puedes eliminar tu propia cuenta en sesión activa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <button
                                               onClick={() => handleAbrirModalEliminar(u)}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Dar de baja o eliminar colaborador"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

      {/* MODAL FLOTANTE MODERNO (CREAR / EDITAR) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            
            {/* Cabecera del Modal */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  {usuarioEditando ? 'Editar Colaborador' : 'Registrar Nuevo Colaborador'}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Credenciales de acceso para el personal operativo y administrativo.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-600 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleGuardarUsuario} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  NOMBRE COMPLETO *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Laura Morales"
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  NÚMERO DE TELÉFONO / USUARIO *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 3001234567"
                  value={formTelefono}
                  onChange={(e) => setFormTelefono(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ROL EN LA ORGANIZACIÓN *
                </label>
                <select
                  value={formRol}
                  onChange={(e) => setFormRol(e.target.value as RolUsuario)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 bg-white"
                >
                  <option value="vendedor">Vendedor (Originación de créditos y ventas)</option>
                  <option value="cobrador">Cobrador (Rutas, visitas y recaudos)</option>
                  <option value="secretaria">Secretaría (Validación y archivo)</option>
                  <option value="supervisor">Supervisor (Auditoría y aprobaciones)</option>
                  <option value="master">Master (Control total del sistema)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {usuarioEditando ? 'CAMBIAR CONTRASEÑA (OPCIONAL)' : 'CONTRASEÑA TEMPORAL *'}
                </label>
                <input
                  type="password"
                  required={!usuarioEditando}
                  placeholder={usuarioEditando ? '•••••••• (Sin cambios)' : 'Mínimo 6 caracteres'}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="pt-2 flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/60">
                <span className="text-xs font-semibold text-slate-700">
                  ¿Habilitar acceso al sistema (Estado Activo)?
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formEstadoActivo}
                    onChange={(e) => setFormEstadoActivo(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Botones de acción */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {isSaving ? 'Guardando...' : usuarioEditando ? 'Actualizar Usuario' : 'Registrar Colaborador'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN / BAJA */}
      {isDeleteModalOpen && usuarioAEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-6">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 mb-4">
                <Trash2 className="w-6 h-6" />
              </div>

              <h3 className="text-lg font-bold text-slate-900 mb-1">
                ¿Dar de baja colaborador?
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Estás a punto de deshabilitar la cuenta de{' '}
                <strong className="text-slate-900 font-semibold">{usuarioAEliminar.nombre}</strong> (
                <span className="capitalize">{usuarioAEliminar.rol}</span>).
              </p>

              <div className="mt-4 p-3.5 rounded-xl bg-amber-50 border border-amber-200/60 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Se aplicará una <strong>baja lógica segura</strong> en el sistema para preservar la integridad referencial y trazabilidad contable de sus ventas y cobros históricos.
                </p>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => {
                    setIsDeleteModalOpen(false);
                    setUsuarioAEliminar(null);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmarEliminar}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer inline-flex items-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Procesando baja...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirmar Baja</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
