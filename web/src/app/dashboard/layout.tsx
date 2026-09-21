'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  PlusCircle,
  CreditCard,
  Package,
  ShieldCheck,
  Wallet,
  Settings,
  LogOut,
  Bell,
  Search,
  ChevronRight,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Layers,
  Menu,
  X,
  TrendingUp,
  Users,
  UserCheck,
  FileSpreadsheet,
  CheckCircle2,
  CalendarDays,
  FolderArchive,
  AlertTriangle,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStoredToken, getStoredUser, isTokenValid, clearAuthSession, hasInactivityTimedOut } from '@/lib/auth';
import { useSessionResilience } from '@/lib/useSessionResilience';

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning';
  roles?: string[]; // Roles autorizados para ver este ítem
}

interface NavSection {
  section: string;
  roles?: string[];
  items: NavItem[];
}

const allNavSections: NavSection[] = [
  {
    section: 'OPERACIÓN DE CAMPO',
    roles: ['master', 'supervisor', 'vendedor'],
    items: [
      { name: 'Nueva Venta (POS)', href: '/dashboard/pos', icon: PlusCircle, badge: 'POS', badgeVariant: 'default', roles: ['master', 'supervisor', 'vendedor'] },
      { name: 'Cartera de Créditos', href: '/dashboard/creditos', icon: CreditCard, roles: ['master', 'supervisor', 'vendedor'] },
      { name: 'Cobranzas & Rutas', href: '/dashboard/secretaria', icon: Wallet, roles: ['master', 'supervisor'] },
      { name: 'Aprobaciones', href: '/dashboard/supervisor', icon: ShieldCheck, badge: 'Auditoría', roles: ['master', 'supervisor'] },
      { name: 'Cartera Crítica & Retiros', href: '/dashboard/cartera-critica', icon: AlertTriangle, badge: 'Riesgo', badgeVariant: 'warning', roles: ['master', 'supervisor'] },
    ],
  },
  {
    section: 'GESTIÓN DE SECRETARÍA & CAJA',
    roles: ['secretaria'],
    items: [
      { name: 'Validación y Arqueo de Caja', href: '/dashboard/secretaria/conciliacion', icon: Wallet, badge: 'Arqueo', badgeVariant: 'success' },
      { name: 'Cierres de Caja Realizados', href: '/dashboard/secretaria', icon: CheckCircle2 },
      { name: 'Reportes Mensuales de Recaudo', href: '/dashboard/reportes', icon: FileSpreadsheet, badge: 'Reportes' },
    ],
  },
  {
    section: 'ADMINISTRACIÓN',
    roles: ['master', 'supervisor', 'vendedor'],
    items: [
      { name: 'Directorio de Clientes', href: '/dashboard/clientes', icon: UserCheck, roles: ['master', 'supervisor', 'vendedor'] },
      { name: 'Gestión de Inventario', href: '/dashboard/productos', icon: Package, roles: ['master', 'supervisor'] },
      { name: 'Reportes e Históricos', href: '/dashboard/reportes', icon: FileSpreadsheet, badge: 'PRO', badgeVariant: 'success', roles: ['master', 'supervisor'] },
      { name: 'Calendario de Cartera', href: '/dashboard/calendario', icon: CalendarDays, badge: 'Agenda', badgeVariant: 'default', roles: ['master', 'supervisor'] },
      { name: 'Comprobantes de Venta y Pago', href: '/dashboard/comprobantes', icon: FolderArchive, badge: 'PDF', badgeVariant: 'default', roles: ['master', 'supervisor'] },
      { name: 'Gestión de Personal', href: '/dashboard/usuarios', icon: Users, roles: ['master', 'supervisor'] },
      { name: 'Configuración & Reglas', href: '/dashboard/configuracion', icon: Settings, roles: ['master', 'supervisor'] },
    ],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<{
    nombre: string;
    rol: string;
    telefono?: string;
  } | null>(null);

  // Hook global de resiliencia ante suspensión, reconexión de red y control de inactividad
  const { resilienceToast, dismissToast } = useSessionResilience();

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedCollapsed = localStorage.getItem('sidebar_collapsed');
      if (savedCollapsed !== null) {
        setIsCollapsed(savedCollapsed === 'true');
      }

      const token = getStoredToken();
      const user = getStoredUser();

      // Validación estricta: si no hay token o expiró, o no hay usuario, o superó inactividad (3h) -> expulsión inmediata
      if (!token || !user || !isTokenValid(token) || hasInactivityTimedOut()) {
        const reason = hasInactivityTimedOut() ? 'inactividad' : 'expirado';
        clearAuthSession();
        setIsAuthenticated(false);
        setIsCheckingAuth(false);
        window.location.replace(`/login?reason=${reason}`);
        return;
      }

      setCurrentUser(user);
      setIsAuthenticated(true);
      setIsCheckingAuth(false);

      // Resincronizar cookie de sesión segura (7 días) para Next.js Edge Middleware
      document.cookie = `remundial_token=${token}; path=/; max-age=604800; SameSite=Lax`;

      const rol = user?.rol?.toLowerCase();

      // Redirección limpia e inteligente por rol para evitar pantallas de 403
      if (rol === 'secretaria' && !pathname.startsWith('/dashboard/secretaria') && !pathname.startsWith('/dashboard/reportes')) {
        router.replace('/dashboard/secretaria/conciliacion');
      } else if (
        rol === 'vendedor' &&
        (pathname === '/dashboard' ||
          pathname.startsWith('/dashboard/supervisor') ||
          pathname.startsWith('/dashboard/cartera-critica') ||
          pathname.startsWith('/dashboard/usuarios') ||
          pathname.startsWith('/dashboard/productos') ||
          pathname.startsWith('/dashboard/configuracion') ||
          pathname.startsWith('/dashboard/comprobantes'))
      ) {
        router.replace('/dashboard/pos');
      } else if (rol === 'cobrador' && !pathname.startsWith('/dashboard/secretaria')) {
        router.replace('/dashboard/secretaria');
      }
    }
  }, [pathname, router]);

  const handleLogout = () => {
    clearAuthSession();
    setShowLogoutModal(false);
    window.location.replace('/login');
  };

  const toggleSidebarCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('sidebar_collapsed', String(next));
      }
      return next;
    });
  };

  // Filtrar navegación por rol del usuario actual
  const userRol = currentUser?.rol?.toLowerCase() || 'supervisor';
  
  const filteredNavSections = allNavSections
    .filter((section) => !section.roles || section.roles.includes(userRol))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles || item.roles.includes(userRol)),
    }))
    .filter((section) => section.items.length > 0);

  // Validación estricta de rutas según rol (RBAC)
  const isRouteAllowed = () => {
    if (!currentUser) return false;

    if (userRol === 'secretaria') {
      // Secretaria enfocada estrictamente en arqueo/caja y reportes de recaudo
      return pathname.startsWith('/dashboard/secretaria') || pathname.startsWith('/dashboard/reportes');
    }

    if (userRol === 'vendedor') {
      // Vendedor no puede acceder a supervisor, cartera-critica, usuarios, configuración, productos, reportes
      const forbiddenForVendedor = [
        '/dashboard/supervisor',
        '/dashboard/cartera-critica',
        '/dashboard/usuarios',
        '/dashboard/configuracion',
        '/dashboard/productos',
        '/dashboard/reportes',
        '/dashboard/comprobantes',
      ];
      return !forbiddenForVendedor.some((r) => pathname.startsWith(r));
    }

    return true; // master y supervisor tienen acceso pleno
  };

  // Determinar título según la ruta actual
  const getPageTitle = () => {
    if (pathname === '/dashboard') return 'Métricas Ejecutivas & Resumen';
    if (pathname.includes('/pos') || pathname.includes('/creditos/nuevo')) return 'Punto de Venta & Originación (POS)';
    if (pathname.includes('/creditos')) return 'Cartera de Créditos';
    if (pathname.includes('/clientes')) return 'Directorio de Clientes';
    if (pathname.includes('/productos')) return 'Catálogo & Gestión de Inventario';
    if (pathname.includes('/cartera-critica')) return 'Cartera Crítica & Artículos Retirados';
    if (pathname.includes('/supervisor')) return 'Módulo de Aprobación de Créditos';
    if (pathname.includes('/reportes')) return 'Reportes e Históricos de Ventas';
    if (pathname.includes('/calendario')) return 'Calendario de Cartera & Vencimientos';
    if (pathname.includes('/comprobantes')) return 'Comprobantes de Venta y Pago';
    if (pathname.includes('/secretaria/conciliacion')) return 'Conciliación de Rutas & Arqueo';
    if (pathname.includes('/secretaria')) return 'Cobranzas & Rutas Operativas';
    if (pathname.includes('/usuarios')) return 'Gestión de Personal & Accesos';
    if (pathname.includes('/configuracion')) return 'Configuración de Parámetros';
    return 'Panel de Control';
  };

  // Auth Guard: Bloquear por completo el renderizado del esqueleto del dashboard si no está autenticado
  if (isCheckingAuth || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-md">
            <Layers className="w-6 h-6 animate-spin text-white" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-slate-800 tracking-tight">Verificando sesión autorizada...</p>
            <p className="text-xs text-slate-400">Protección de acceso Remundial Core</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      
      {/* OVERLAY PARA MÓVIL */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* SIDEBAR MODERNO TIPO VERCEL / LINEAR CON MODO COLAPSABLE */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 bg-white border-r border-slate-200/80 flex flex-col justify-between transition-all duration-300 ease-in-out md:static md:translate-x-0 shadow-sm overflow-hidden select-none',
          isCollapsed ? 'w-20' : 'w-80',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Cabecera / Identidad */}
        <div>
          <div
            className={cn(
              'h-16 border-b border-slate-100 flex items-center transition-all duration-300',
              isCollapsed ? 'px-3 justify-between' : 'px-6 justify-between'
            )}
          >
            <Link href="/dashboard" className="flex items-center gap-3 overflow-hidden">
              <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center text-white font-black shadow-sm shrink-0">
                <Layers className="w-5 h-5" />
              </div>
              {!isCollapsed && (
                <div className="truncate transition-opacity duration-200 animate-in fade-in">
                  <span className="font-bold text-base tracking-tight text-slate-900 flex items-center gap-1.5">
                    Remundial <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Pro</span>
                  </span>
                  <span className="text-xs text-slate-600 block truncate">Créditos & Cobranza</span>
                </div>
              )}
            </Link>

            {/* Botón de control de contracción en Desktop */}
            <button
              onClick={toggleSidebarCollapse}
              className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              title={isCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'}
              aria-label={isCollapsed ? 'Expandir menú' : 'Contraer menú'}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="w-4 h-4 text-slate-600" />
              ) : (
                <PanelLeftClose className="w-4 h-4 text-slate-600" />
              )}
            </button>

            {/* Botón de cierre en Móvil */}
            <button
              onClick={() => setMobileOpen(false)}
              className="md:hidden p-1 text-slate-600 hover:text-slate-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Indicador de Estado del Sistema */}
          {isCollapsed ? (
            <div
              className="mx-3 my-3 p-2 rounded-xl bg-emerald-50/70 border border-emerald-100 flex items-center justify-center cursor-help"
              title="Servidor FastAPI Activo (v1.2.0)"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>
          ) : (
            <div className="mx-4 my-3 px-3 py-2 rounded-xl bg-emerald-50/70 border border-emerald-100 flex items-center justify-between transition-all duration-200">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-medium text-emerald-800">Servidor FastAPI Activo</span>
              </div>
              <span className="text-[11px] font-mono text-emerald-600">v1.2.0</span>
            </div>
          )}

          {/* Lista de Navegación por Secciones */}
          <nav
            className={cn(
              'py-2 space-y-5 overflow-y-auto overflow-x-hidden max-h-[calc(100vh-230px)] transition-all',
              isCollapsed ? 'px-2' : 'px-3'
            )}
          >
            {/* Acceso Ejecutivo para Supervisor y Master */}
            {(userRol === 'supervisor' || userRol === 'master') && (
              <div className="space-y-1">
                {!isCollapsed ? (
                  <p className="px-3 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    VISTA GENERAL
                  </p>
                ) : (
                  <div className="h-px bg-slate-100 my-2 mx-1" />
                )}
                <Link
                  href="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  title={isCollapsed ? 'Dashboard Gerencial' : undefined}
                  className={cn(
                    'flex items-center rounded-xl text-sm font-medium transition-all group relative',
                    isCollapsed
                      ? 'justify-center p-2.5'
                      : 'justify-between px-3 py-2.5',
                    pathname === '/dashboard'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  )}
                >
                  <div className={cn('flex items-center', isCollapsed ? 'justify-center' : 'gap-3')}>
                    <LayoutDashboard
                      className={cn(
                        'w-4 h-4 transition-colors shrink-0',
                        pathname === '/dashboard'
                          ? 'text-white'
                          : 'text-slate-600 group-hover:text-slate-700'
                      )}
                    />
                    {!isCollapsed && <span className="truncate">Dashboard Gerencial</span>}
                  </div>
                </Link>
              </div>
            )}

            {filteredNavSections.map((section, idx) => (
              <div key={idx} className="space-y-1">
                {!isCollapsed ? (
                  <p className="px-3 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    {section.section}
                  </p>
                ) : (
                  <div className="h-px bg-slate-100 my-2 mx-1" />
                )}
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      title={isCollapsed ? item.name : undefined}
                      className={cn(
                        'flex items-center rounded-xl text-sm font-medium transition-all group relative',
                        isCollapsed
                          ? 'justify-center p-2.5'
                          : 'justify-between px-3 py-2.5',
                        isActive
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                      )}
                    >
                      <div className={cn('flex items-center relative', isCollapsed ? 'justify-center' : 'gap-3')}>
                        <Icon
                          className={cn(
                            'w-4 h-4 transition-colors shrink-0',
                            isActive
                              ? 'text-white'
                              : 'text-slate-600 group-hover:text-slate-700'
                          )}
                        />
                        {!isCollapsed && <span className="truncate whitespace-nowrap">{item.name}</span>}

                        {/* Indicador de badge compacto en modo colapsado */}
                        {isCollapsed && item.badge && (
                          <span
                            className={cn(
                              'absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-white',
                              item.badgeVariant === 'warning'
                                ? 'bg-amber-500'
                                : item.badgeVariant === 'success'
                                ? 'bg-emerald-500'
                                : 'bg-slate-700'
                            )}
                          />
                        )}
                      </div>

                      {!isCollapsed && item.badge && (
                        <span
                          className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0',
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Footer del Sidebar con Perfil Dinámico y Logout */}
        <div className="p-3 border-t border-slate-100">
          {!isCollapsed ? (
            <>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5 truncate">
                  <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    {currentUser?.nombre
                      ? currentUser.nombre
                          .split(' ')
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()
                      : 'DG'}
                  </div>
                  <div className="truncate">
                    <p className="text-xs font-semibold text-slate-800 leading-tight truncate">
                      {currentUser?.nombre || 'Dirección General'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-700">
                        {currentUser?.rol || 'SUPERVISOR'}
                      </span>
                      {currentUser?.telefono && (
                        <span className="text-[10px] text-slate-600 font-mono truncate">
                          {currentUser.telefono}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowLogoutModal(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar Sesión</span>
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0 cursor-default"
                title={`${currentUser?.nombre || 'Dirección General'} (${currentUser?.rol || 'SUPERVISOR'})`}
              >
                {currentUser?.nombre
                  ? currentUser.nombre
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()
                  : 'DG'}
              </div>
              <button
                type="button"
                onClick={() => setShowLogoutModal(true)}
                className="p-2 rounded-xl text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                title="Cerrar Sesión"
                aria-label="Cerrar Sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL Y HEADER SUPERIOR */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Header Superior Moderno */}
        <header className="sticky top-0 z-30 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/80 px-6 sm:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 -ml-2 text-slate-600 hover:text-slate-900 md:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Breadcrumb sutil */}
            <div className="flex items-center gap-2 text-sm">
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-700 font-medium">
                Admin
              </Link>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
              <span className="font-semibold text-slate-800">{getPageTitle()}</span>
            </div>
          </div>

          {/* Acciones Rápidas adaptadas según rol */}
          <div className="flex items-center gap-3">
            {userRol === 'secretaria' ? (
              <Link
                href="/dashboard/secretaria/conciliacion"
                className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold px-4 py-2 rounded-xl shadow-sm transition-all"
              >
                <Wallet className="w-4 h-4" />
                <span>Conciliación de Caja</span>
              </Link>
            ) : (
              <Link
                href="/dashboard/pos"
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold px-4 py-2 rounded-xl shadow-sm transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Nueva Venta (POS)</span>
              </Link>
            )}
          </div>
        </header>

        {/* Zona de Trabajo */}
        <main className="flex-1 p-6 sm:p-8 lg:p-10 max-w-7xl w-full mx-auto">
          {!isRouteAllowed() ? (
            <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
                <Layers className="w-5 h-5 animate-spin" />
              </div>
              <p className="text-xs font-semibold text-slate-500">
                Redirigiendo a tu espacio de trabajo autorizado...
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* MODAL FLOTANTE CORPORATIVO DE CONFIRMACIÓN DE CIERRE DE SESIÓN */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0 shadow-2xs">
                <LogOut className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  ¿Estás seguro de que deseas cerrar sesión?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Tu sesión actual será finalizada de forma segura. Tendrás que ingresar nuevamente con tus credenciales corporativas autorizadas para acceder a la plataforma.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sí, Salir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST FLOTANTE GLOBAL DE RESILIENCIA Y RECONEXIÓN DE RED */}
      <div
        className={cn(
          'fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 max-w-sm sm:max-w-md w-full pointer-events-auto transition-all duration-300 ease-out transform',
          resilienceToast
            ? 'translate-y-0 opacity-100 scale-100'
            : 'translate-y-4 opacity-0 scale-95 pointer-events-none'
        )}
      >
        {resilienceToast && (
          <div
            className={cn(
              'bg-white/95 backdrop-blur-md rounded-2xl border p-4 shadow-xl flex items-start gap-3.5 relative overflow-hidden',
              resilienceToast.type === 'warning'
                ? 'border-amber-200/90 shadow-amber-950/10'
                : 'border-emerald-200/90 shadow-slate-900/10'
            )}
          >
            {/* Acento lateral */}
            <div
              className={cn(
                'absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl',
                resilienceToast.type === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
              )}
            />

            {/* Ícono de estado de conexión */}
            <div
              className={cn(
                'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 shadow-xs border',
                resilienceToast.type === 'warning'
                  ? 'bg-amber-50 text-amber-600 border-amber-200/60'
                  : 'bg-emerald-50 text-emerald-600 border-emerald-200/60'
              )}
            >
              {resilienceToast.type === 'warning' ? (
                <WifiOff className="w-5 h-5" />
              ) : (
                <Wifi className="w-5 h-5" />
              )}
            </div>

            <div className="flex-1 min-w-0 pr-1">
              <div className="flex items-center gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                  {resilienceToast.title}
                </h4>
                <span
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0',
                    resilienceToast.type === 'warning'
                      ? 'bg-amber-100 text-amber-800 border-amber-200/60'
                      : 'bg-emerald-100 text-emerald-800 border-emerald-200/60'
                  )}
                >
                  {resilienceToast.type === 'warning' ? 'Aviso' : 'Reconectado'}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {resilienceToast.message}
              </p>
            </div>

            <button
              type="button"
              onClick={dismissToast}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
              title="Cerrar notificación"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
