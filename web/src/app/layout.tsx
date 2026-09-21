import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Remundial Core | Plataforma de Créditos y Cartera',
  description: 'Sistema empresarial SaaS para gestión, originación y cobranza de créditos en terreno',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full bg-slate-50 antialiased">
      <body className="min-h-full flex flex-col text-slate-900 bg-slate-50 font-sans">
        {children}
      </body>
    </html>
  );
}
