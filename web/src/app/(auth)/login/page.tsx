'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogIn, AlertCircle, Layers, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { saveAuthSession, getStoredToken, getStoredUser, clearAuthSession, hasInactivityTimedOut } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [inactivityNotice, setInactivityNotice] = useState<string | null>(null);
  const [brandInfo, setBrandInfo] = useState({
    razon_social: 'Remundial Core',
    eslogan_login: 'Plataforma Central de Crédito & Cobranza',
    pie_login: 'Acceso restringido únicamente a colaboradores autorizados de Remundial.',
    tiene_logo: false,
    logo_url: null as string | null,
  });

  // Detección de redirección por inactividad prolongada o suspensión
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const reason = params.get('reason');
      if (reason === 'inactividad' || hasInactivityTimedOut()) {
        clearAuthSession();
        setInactivityNotice(
          'Por motivos de seguridad, tu sesión ha finalizado automáticamente tras superar 3 horas de inactividad continua o suspensión del equipo. Ingresa tus credenciales para reanudar tus labores.'
        );
      }
    }
  }, []);

  // Cargar identidad institucional pública sin requerir sesión
  useEffect(() => {
    const cargarIdentidad = async () => {
      try {
        const res = await api.get('/configuracion/identidad-publica');
        if (res.data) {
          const rawUrl = res.data.logo_url;
          const fullLogoUrl = rawUrl
            ? (rawUrl.startsWith('http') ? rawUrl : `${api.defaults.baseURL || ''}${rawUrl}`)
            : null;
          setBrandInfo({
            razon_social: res.data.razon_social || 'Remundial Core',
            eslogan_login: res.data.eslogan_login || 'Plataforma Central de Crédito & Cobranza',
            pie_login: res.data.pie_login || 'Acceso restringido únicamente a colaboradores autorizados de Remundial.',
            tiene_logo: Boolean(res.data.tiene_logo),
            logo_url: fullLogoUrl,
          });
        }
      } catch (err) {
        // En caso de indisponibilidad del backend, mantiene fallbacks estáticos seguros
      }
    };
    cargarIdentidad();
  }, []);

  // Si ya existe una sesión válida previa y no ha expirado por inactividad, redirigir automáticamente al dashboard
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('reason') === 'inactividad' || hasInactivityTimedOut()) {
        return;
      }
    }

    const token = getStoredToken();
    const user = getStoredUser();
    if (token && user) {
      const userRol = user.rol?.toLowerCase();
      if (userRol === 'secretaria') {
        router.replace('/dashboard/secretaria/conciliacion');
      } else if (userRol === 'vendedor') {
        router.replace('/dashboard/pos');
      } else if (userRol === 'cobrador') {
        router.replace('/dashboard/secretaria');
      } else {
        router.replace('/dashboard');
      }
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!identifier.trim() || !password) {
      setErrorMessage('Por favor complete su usuario o teléfono y contraseña.');
      return;
    }

    try {
      setIsLoading(true);

      const params = new URLSearchParams();
      params.append('username', identifier.trim());
      params.append('password', password);

      const response = await api.post('/auth/login', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token, usuario } = response.data;

      // Almacenamiento seguro sincronizado en localStorage y cookie
      saveAuthSession(access_token, usuario);

      // Redirección limpia e inteligente por rol operativo
      const userRol = usuario?.rol?.toLowerCase();
      if (userRol === 'secretaria') {
        router.push('/dashboard/secretaria/conciliacion');
      } else if (userRol === 'vendedor') {
        router.push('/dashboard/pos');
      } else if (userRol === 'cobrador') {
        router.push('/dashboard/secretaria');
      } else {
        router.push('/dashboard');
      }
    } catch (error: any) {
      console.error('Error al autenticar:', error);
      let msg = 'No fue posible iniciar sesión. Verifique sus credenciales.';
      if (error.response?.data?.detail) {
        msg = typeof error.response.data.detail === 'string'
          ? error.response.data.detail
          : JSON.stringify(error.response.data.detail);
      }
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6 animate-in fade-in duration-200">
        
        {/* Marca / Identidad Corporativa */}
        <div className="text-center space-y-2">
          {brandInfo.tiene_logo && brandInfo.logo_url ? (
            <div className="w-16 h-16 mx-auto rounded-2xl bg-white border border-slate-200/90 shadow-sm p-1.5 flex items-center justify-center transition-all hover:shadow-md">
              <img
                src={brandInfo.logo_url}
                alt={brandInfo.razon_social}
                className="w-full h-full object-contain rounded-xl"
                onError={() => setBrandInfo((prev) => ({ ...prev, tiene_logo: false }))}
              />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto shadow-md">
              <Layers className="w-6 h-6" />
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {brandInfo.razon_social}
          </h1>
          <p className="text-xs text-slate-600 font-medium">
            {brandInfo.eslogan_login}
          </p>
        </div>

        {/* Tarjeta de Autenticación */}
        <div className="bg-white rounded-2xl p-7 border border-slate-200/80 shadow-sm space-y-5">
          {inactivityNotice && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-amber-950">Sesión expirada por seguridad</p>
                <p className="text-amber-800/95 leading-relaxed">{inactivityNotice}</p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                USUARIO O TELÉFONO DE ACCESO
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Ingrese su teléfono o nombre de usuario"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                CONTRASEÑA
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 transition-all bg-slate-50/50 focus:bg-white"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-xs font-semibold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              <span>{isLoading ? 'Verificando credenciales...' : 'Iniciar Sesión'}</span>
            </button>
          </form>
        </div>

        {/* Pie institucional de seguridad */}
        <div className="text-center space-y-1">
          <p className="text-[11px] text-slate-600">
            {brandInfo.pie_login}
          </p>
          <p className="text-[10px] text-slate-500">
            Sesión protegida mediante tokens criptográficos JWT y control de accesos RBAC.
          </p>
        </div>

      </div>
    </main>
  );
}
