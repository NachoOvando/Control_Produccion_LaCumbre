"use client";

import { useEffect, useRef } from "react";

type Props = {
  valor: string;
  onCambio: (v: string) => void;
  onConfirmar: () => void;
  label?: string;
  // Se llama al tocar FUERA del panel de teclas (fondo de página, espacio
  // lateral de la banda fija, etc.). Usa "click" en fase de CAPTURA (no
  // pointerdown): un gesto de scroll dispara pointerdown/pointerup sin click,
  // así que el numpad ya no se cierra al scrollear una pantalla larga. La fase
  // de captura corre antes del onClick del propio botón que abrió el numpad,
  // así que tocar otra celda cierra y reabre con el campo nuevo sin problema.
  onCerrar?: () => void;
};

export function NumpadIndustrial({ valor, onCambio, onConfirmar, label, onCerrar }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onCerrar) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCerrar();
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [onCerrar]);

  const presionar = (tecla: string) => {
    if (tecla === "⌫") {
      onCambio(valor.slice(0, -1));
      return;
    }
    if (tecla === "C") {
      onCambio("");
      return;
    }
    if (tecla === "." && valor.includes(".")) return;
    if (valor.replace(".", "").length >= 5) return;
    onCambio(valor + tecla);
  };

  const filas = [
    ["7", "8", "9"],
    ["4", "5", "6"],
    ["1", "2", "3"],
    ["C", "0", "."],
  ];

  return (
    <div className="fixed bottom-0 inset-x-0 bg-white border-t-2 border-gray-200 shadow-2xl z-40">
      <div ref={panelRef} className="max-w-sm mx-auto p-3 pb-5">
        {/* Pantalla */}
        <div className="bg-gray-50 rounded-xl px-4 py-2.5 mb-3 flex items-center justify-between gap-2 min-h-[52px]">
          <span className="text-xs font-semibold text-gray-500 truncate max-w-[55%]">
            {label ?? "Medición"}
          </span>
          <span className={`text-3xl font-bold font-mono tracking-tight ${valor ? "text-gray-900" : "text-gray-300"}`}>
            {valor || "—"}
          </span>
        </div>

        <div className="flex gap-2">
          {/* Grilla numérica */}
          <div className="flex-1 grid grid-cols-3 gap-2">
            {filas.flat().map((tecla) => (
              <button
                key={tecla}
                type="button"
                onClick={() => presionar(tecla)}
                className={`
                  h-14 rounded-xl text-xl font-bold transition-all active:scale-95
                  ${tecla === "C"
                    ? "bg-amber-50 text-amber-700 active:bg-amber-100"
                    : tecla === "."
                    ? "bg-gray-100 text-gray-700 active:bg-gray-200"
                    : "bg-gray-100 text-gray-800 active:bg-gray-200"
                  }
                `}
              >
                {tecla === "." ? "," : tecla}
              </button>
            ))}
            <button
              type="button"
              onClick={() => presionar("⌫")}
              className="col-span-3 h-11 rounded-xl text-base font-bold bg-gray-100 text-gray-700 active:bg-gray-200 transition-all active:scale-95"
            >
              ⌫ Borrar
            </button>
          </div>

          {/* OK — columna derecha */}
          <button
            type="button"
            onClick={onConfirmar}
            className="w-20 rounded-xl bg-[#E1000F] text-white font-bold text-base flex flex-col items-center justify-center gap-1 active:bg-[#c0000d] active:scale-95 transition-all shadow-lg shadow-red-100"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            <span>OK</span>
          </button>
        </div>
      </div>
    </div>
  );
}
