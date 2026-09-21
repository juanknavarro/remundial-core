import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

function isTokenValid(token: string | undefined): boolean {
  if (!token || typeof token !== 'string' || token.trim().length < 15) return false;
  try {
    const parts = token.trim().split('.');
    if (parts.length === 3) {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      if (payload.exp && typeof payload.exp === 'number') {
        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec >= payload.exp) return false;
      }
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export default async function RootHomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('remundial_token')?.value;

  if (isTokenValid(token)) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
