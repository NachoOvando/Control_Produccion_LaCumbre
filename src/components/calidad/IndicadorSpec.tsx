"use client";

// Indicador visual de "medido vs. especificación" para los formularios de
// captura (ADR-015). Muestra el rango objetivo y, si hay un valor, lo colorea:
// verde = dentro, ámbar = fuera de aceptación, rojo = fuera del límite crítico.
// NO bloquea nada — es solo señal visual (el punto HACCP es registrar, no impedir).

import { evaluarValor, formatearRango, type EstadoSpec } from "@/lib/calidad/especificaciones";
import type { EspecCampo } from "@/types/calidad";

const ESTILO: Record<Exclude<EstadoSpec, "sin_spec">, { dot: string; texto: string; label: string }> = {
  dentro: { dot: "bg-green-500", texto: "text-green-700", label: "dentro de especificación" },
  fuera_aceptacion: { dot: "bg-amber-500", texto: "text-amber-700", label: "fuera del rango de aceptación" },
  fuera_critico: { dot: "bg-red-500", texto: "text-red-700", label: "fuera del límite crítico" },
};

// Etiqueta del rango objetivo — para mostrar junto al label del campo. Devuelve
// null si la spec no tiene ningún límite mostrable.
export function RangoObjetivo({ spec }: { spec: EspecCampo }) {
  const rango = formatearRango(spec, spec.unidad);
  if (!rango) return null;
  return (
    <span className="text-[11px] font-normal text-gray-400">
      objetivo {rango}
      {spec.esCritico && <span className="ml-1 text-red-500">· PCC</span>}
    </span>
  );
}

// Punto de color que evalúa un valor contra la spec. `size` chico para celdas
// de mediciones; texto opcional para campos escalares.
export function IndicadorSpec({ valor, spec, conTexto = false }: { valor: number | null; spec: EspecCampo; conTexto?: boolean }) {
  if (valor == null || !Number.isFinite(valor)) return null;
  const estado = evaluarValor(valor, spec);
  if (estado === "sin_spec") return null;
  const e = ESTILO[estado];
  return (
    <span className="inline-flex items-center gap-1" title={e.label}>
      <span className={`inline-block w-2 h-2 rounded-full ${e.dot}`} aria-hidden />
      {conTexto && estado !== "dentro" && (
        <span className={`text-[11px] font-semibold ${e.texto}`}>
          {estado === "fuera_critico" ? "crítico" : "fuera"}
        </span>
      )}
    </span>
  );
}

// Helper: busca la spec de un campo dado dentro del array del producto activo.
export function specDeCampo(especificaciones: EspecCampo[] | undefined, campoData: string): EspecCampo | null {
  if (!especificaciones) return null;
  return especificaciones.find((e) => e.campoData === campoData) ?? null;
}
