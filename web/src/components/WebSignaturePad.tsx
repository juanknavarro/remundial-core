'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { RotateCcw, Check, PenTool, Tablet, MousePointer } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WebSignaturePadProps {
  label?: string;
  subtitle?: string;
  badgeText?: string;
  badgeVariant?: 'required' | 'optional';
  pdfMapping?: string;
  onChange: (base64Png: string | null) => void;
  height?: number;
  className?: string;
}

export default function WebSignaturePad({
  label = 'Firma Digital del Supervisor / Asesor Autorizado',
  subtitle = 'Utilice tableta digitalizadora USB, lápiz óptico o el ratón para estampar la firma',
  badgeText,
  badgeVariant = 'required',
  pdfMapping,
  onChange,
  height = 135,
  className = '',
}: WebSignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [pointerType, setPointerType] = useState<string>('pen');

  // Configurar el canvas con soporte para alta resolución (DPI/Retina)
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A'; // Slate-900 elegante
    ctx.lineWidth = 2.2;
  }, []);

  useEffect(() => {
    setupCanvas();

    const handleResize = () => {
      setupCanvas();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setupCanvas]);

  const getPointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.setPointerCapture(e.pointerId);
    setPointerType(e.pointerType || 'pen');
    setIsDrawing(true);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPointerPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPointerPos(e);

    if (e.pressure && e.pressure > 0) {
      ctx.lineWidth = Math.max(1.2, Math.min(4.5, e.pressure * 4.5));
    } else {
      ctx.lineWidth = 2.2;
    }

    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    if (!hasSignature) {
      setHasSignature(true);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignorar si no estaba capturado
    }

    const dataUrl = canvas.toDataURL('image/png');
    onChange(dataUrl);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignorar
    }
  };

  const handleLimpiar = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onChange(null);
  };

  return (
    <div
      className={cn(
        'bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:border-slate-300/90 transition-all p-3.5 sm:p-4 flex flex-col justify-between space-y-2.5 select-none w-full min-w-0 overflow-hidden',
        className
      )}
    >
      {/* 1. Cabecera limpia y no saturada */}
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5 truncate min-w-0">
            <PenTool className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate">{label}</span>
          </span>
          {badgeText && (
            <span
              className={cn(
                'text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 uppercase tracking-wider',
                badgeVariant === 'required'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              )}
            >
              {badgeText}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-[11px] text-slate-500 mt-1 leading-snug line-clamp-2">{subtitle}</p>
        )}
      </div>

      {/* 2. Franja de Herramientas y Estado Centrada Simétricamente */}
      <div className="w-full bg-slate-50/90 rounded-xl p-2.5 border border-slate-100/90 flex flex-col items-center justify-center gap-2">
        {/* Píldora de Estado del Trazo (Arriba en el centro) */}
        <div className="flex items-center justify-center">
          {hasSignature ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1 rounded-full bg-emerald-100/90 text-emerald-800 border border-emerald-300 shadow-2xs">
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Trazo Capturado</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full bg-white text-slate-500 border border-slate-200 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0"></span>
              <span>Esperando Firma</span>
            </span>
          )}
        </div>

        {/* Botones de Control Inferiores (Abajo centrados y simétricos) */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <div
            className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-600 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 shadow-2xs"
            title={pointerType === 'pen' ? 'Tableta digitalizadora USB activa' : 'Mouse o puntero activo'}
          >
            {pointerType === 'pen' ? (
              <>
                <Tablet className="w-3 h-3 text-emerald-600 shrink-0" />
                <span className="font-medium">Tableta USB</span>
              </>
            ) : (
              <>
                <MousePointer className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="font-medium">Mouse</span>
              </>
            )}
          </div>

          {hasSignature && (
            <button
              type="button"
              onClick={handleLimpiar}
              className="inline-flex items-center gap-1.5 px-3 py-0.5 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 active:scale-95 rounded-md border border-rose-200 transition-all cursor-pointer shadow-2xs"
              title="Borrar trazo para firmar de nuevo"
            >
              <RotateCcw className="w-3 h-3 shrink-0" />
              <span>Limpiar</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Contenedor del Lienzo Táctil */}
      <div className="relative w-full border-2 border-dashed border-slate-200 hover:border-slate-300 focus-within:border-emerald-500 rounded-xl bg-slate-50/70 overflow-hidden transition-colors">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          style={{ height: `${height}px`, width: '100%' }}
          className="w-full touch-none cursor-crosshair block bg-transparent"
        />

        {/* Línea guía de firma tradicional */}
        <div className="absolute bottom-4 left-6 right-6 pointer-events-none flex flex-col items-center">
          <div className="w-full border-b border-slate-300" />
          <span className="text-[9.5px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">
            Línea de Firma Digital
          </span>
        </div>

        {/* Marca de agua informativa mientras no se ha firmado */}
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400/80 text-[11px] font-medium tracking-wide gap-1.5 px-2 text-center">
            <Tablet className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Firme aquí con tableta USB o ratón</span>
          </div>
        )}
      </div>

      {/* 4. Pie de Mapeo en PDF Oficial */}
      {pdfMapping && (
        <div className="text-[10.5px] text-slate-500 px-0.5 pt-0.5 flex items-center gap-1 truncate min-w-0">
          <span className="font-semibold text-slate-700 shrink-0">Mapeo PDF:</span>
          <span className="truncate">{pdfMapping}</span>
        </div>
      )}
    </div>
  );
}
