import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Valida de forma ligera en el Edge si el token JWT no ha expirado.
 */
function isEdgeTokenValid(token: string | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  const clean = token.trim();
  if (clean.length < 15) return false;

  try {
    const parts = clean.split('.');
    if (parts.length === 3) {
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      base64 = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
      const jsonPayload = atob(base64);
      const parsed = JSON.parse(jsonPayload);
      if (parsed.exp && typeof parsed.exp === 'number') {
        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec >= parsed.exp) {
          return false;
        }
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('remundial_token')?.value;
  const hasValidSession = isEdgeTokenValid(token);

  // 1. Protección estricta de rutas /dashboard y descendientes
  if (pathname.startsWith('/dashboard')) {
    if (!hasValidSession) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const response = NextResponse.redirect(loginUrl);
      // Limpiar cookie expirada si existía
      if (token) {
        response.cookies.delete('remundial_token');
      }
      return response;
    }
  }

  // 2. Ruta raíz (/)
  if (pathname === '/') {
    if (hasValidSession) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    } else {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // 3. Página de Login (/login)
  if (pathname === '/login') {
    if (hasValidSession) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/dashboard/:path*'],
};
