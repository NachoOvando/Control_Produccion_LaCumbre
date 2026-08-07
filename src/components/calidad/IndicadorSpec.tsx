"use client";

// Indicador visual de "medido vs. especificación" para los formularios de
// captura (ADR-015). Colorea el valor: verde = dentro, ámbar = fuera de
// aceptación, rojo = fuera del límite crítico. NO bloquea nada — es solo señal
// visual (el punto HACCP es registrar la desviación, no impedirla).
//
// Sujeto a la política de DOS CAPAS (ver lib/calidad/especificaciones.ts):
// mientras el operario tipea solo se revela la capa crítica; el objetivo y el
// rango de aceptación aparecen cuando la muestra está completa. Por eso todos
// los componentes de acá reciben `fase`.

import {
  estadoVisible,
  formatearRangoVisible,
  type EstadoSpec,
  type FaseMuestra,
} from "@/lib/calidad/especificaciones";
import type { EspecCampo } from "@/types/calidad";

const ESTILO: Record<Exclude<EstadoSpec, "sin_spec">, { dot: string; texto: string; label: string }> = {
  dentro: { dot: "bg-green-500", texto: "text-green-700", label: "dentro de especificación" },
  fuera_aceptacion: { dot: "bg-amber-500", texto: "text-amber-700", label: "fuera del rango de aceptación" },
  fuera_critico: { dot: "bg-red-500", texto: "text-red-700", label: "fuera del límite crítico" },
};

// Etiqueta del rango a mostrar junto al label del campo. Durante la captura
// muestra SOLO el rango crítico: el rango de aceptación escrito al lado del campo
// ("objetivo 72–78 g") es el ancla más fuerte de todas, más que el punto de
// color. Devuelve null si no hay nada mostrable en esta fase.
export function RangoObjetivo({ spec, fase }: { spec: EspecCampo; fase: FaseMuestra }) {
  const rango = formatearRangoVisible(spec, spec.unidad, fase);
  if (!rango) return null;
  const esCriticoTexto = rango.startsWith("crítico");
  return (
    <span className={`text-[11px] font-normal ${esCriticoTexto ? "text-red-400" : "text-gray-400"}`}>
      {rango}
      {spec.esCritico && <span className="ml-1 text-red-500">· PCC</span>}
    </span>
  );
}

// Punto de color que evalúa un valor contra la spec. En fase `capturando` solo
// aparece si el valor cruzó el límite crítico; el resto del tiempo no renderiza
// nada, para que el operario no pueda inferir hacia dónde mover el número.
export function IndicadorSpec({
  valor,
  spec,
  fase,
  conTexto = false,
}: {
  valor: number | null;
  spec: EspecCampo;
  fase: FaseMuestra;
  conTexto?: boolean;
}) {
  if (valor == null || !Number.isFinite(valor)) return null;
  const estado = estadoVisible(valor, spec, fase);
  if (estado === null) return null;
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

// Aviso para el operario de que la evaluación todavía no se muestra. Sin esto, la
// ausencia del semáforo se lee como "no hay especificación cargada" — y esa
// ambigüedad es peor que no tener la política: el operario no sabe si el sistema
// está callado a propósito o si nadie cargó la spec.
export function AvisoEvaluacionPendiente({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p className="text-[11px] text-gray-400 leading-snug">
      La evaluación contra especificación se muestra al completar la muestra. Los
      límites críticos se avisan en el momento.
    </p>
  );
}

// Helper: busca la spec de un campo dado dentro del array del producto activo.
export function specDeCampo(especificaciones: EspecCampo[] | undefined, campoData: string): EspecCampo | null {
  if (!especificaciones) return null;
  return especificaciones.find((e) => e.campoData === campoData) ?? null;
}
