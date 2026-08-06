"use client";

// Selector de "muestras" (tabs M1, M2...) compartido por los formularios que
// permiten cargar varias muestras por jornada: TemperaturaForm,
// PesoMedicionesForm (ambos submodos) y DefectosConformadoForm.
//
// Antes de este componente, el mismo JSX estaba duplicado casi al pie de la
// letra en los 4 lugares, con el chip inactivo sin fondo ni borde propio
// (solo `text-gray-600` sobre un contenedor gris claro) — se leía como texto
// suelto, no como botón. Fix: chip activo con fondo de marca (#E1000F) +
// texto blanco, chip inactivo con fondo y borde propios.

import type { ReactNode } from "react";

type MuestraConId = { id: number };

type Props<T extends MuestraConId> = {
  muestras: T[];
  muestraActivaId: number;
  onSeleccionar: (id: number) => void;
  onAgregar: () => void;
  onEliminar: () => void;
  puedeEliminar: boolean;
  // Cada formulario decide su propia semántica de "completa" (✓) o "atención"
  // (⚠) — el selector es agnóstico a esa lógica de negocio.
  renderInsignia?: (muestra: T) => ReactNode | null;
};

export function SelectorMuestras<T extends MuestraConId>({
  muestras,
  muestraActivaId,
  onSeleccionar,
  onAgregar,
  onEliminar,
  puedeEliminar,
  renderInsignia,
}: Props<T>) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Muestras</p>
      <div className="bg-[#f0f0f0] rounded-xl p-3 flex items-center gap-2 overflow-x-auto">
        {muestras.map((m) => {
          const activa = m.id === muestraActivaId;
          return (
            <div key={m.id} className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => onSeleccionar(m.id)}
                aria-pressed={activa}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-1.5 border-2 ${
                  activa
                    ? "bg-[#E1000F] text-white border-[#E1000F] shadow"
                    : "bg-white/80 border-gray-200 text-gray-700 hover:bg-white"
                }`}
              >
                M{m.id}
                {renderInsignia?.(m)}
              </button>
              {puedeEliminar && activa && (
                // 32px de hit-area (no 16-20px como antes): con guantes o
                // dedos húmedos, un botón chico sobre una acción destructiva
                // sin red de seguridad es el error de diseño más caro, no el
                // de contraste. Borde blanco para que se despegue del fondo
                // rojo del chip activo.
                <button
                  type="button"
                  aria-label={`Eliminar muestra ${m.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEliminar();
                  }}
                  className="absolute -top-2 -right-2 w-8 h-8 bg-red-600 text-white rounded-full text-sm flex items-center justify-center border-2 border-white shadow hover:bg-red-700 active:scale-95"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAgregar}
          className="flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-white/60 flex items-center gap-1 transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Muestra
        </button>
      </div>
    </div>
  );
}
