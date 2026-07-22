// Comparación medido-vs-especificación — lógica pura, sin dependencias de
// framework, testeable de forma aislada. La usan tanto los formularios de
// captura (marca en vivo) como el service.
//
// Separación de capas de límite (ADR-015):
//   - rango de ACEPTACIÓN (aceptacionMin/Max): límite operativo/de calidad.
//   - límite CRÍTICO (criticoMin/Max): inocuidad/PCC, más externo.
// Bordes INCLUSIVOS en ambos. Superar el crítico NO bloquea el guardado; solo
// cambia el estado devuelto (la UI lo marca distinto).

export type EspecLimites = {
  objetivo?: number | null;
  aceptacionMin?: number | null;
  aceptacionMax?: number | null;
  criticoMin?: number | null;
  criticoMax?: number | null;
  esCritico?: boolean;
};

// Orden de severidad: dentro < fuera_aceptacion < fuera_critico. "sin_spec"
// cuando no hay ningún límite cargado (no se puede evaluar).
export type EstadoSpec = "dentro" | "fuera_aceptacion" | "fuera_critico" | "sin_spec";

// Evalúa un valor medido contra los límites. Reglas:
//  - Fuera del rango crítico (si está definido) → "fuera_critico" (lo más grave).
//  - Si no, fuera del rango de aceptación (si está definido) → "fuera_aceptacion".
//  - Si no, "dentro".
//  - Sin ningún límite definido → "sin_spec".
// Cada borde se evalúa solo si ese límite está definido (min y max son
// independientes — scm-alimentos: tolerancia asimétrica legítima).
export function evaluarValor(valor: number, spec: EspecLimites): EstadoSpec {
  if (!Number.isFinite(valor)) return "sin_spec";

  const { aceptacionMin, aceptacionMax, criticoMin, criticoMax } = spec;
  const tieneAceptacion = aceptacionMin != null || aceptacionMax != null;
  const tieneCritico = criticoMin != null || criticoMax != null;

  if (!tieneAceptacion && !tieneCritico) return "sin_spec";

  if (criticoMin != null && valor < criticoMin) return "fuera_critico";
  if (criticoMax != null && valor > criticoMax) return "fuera_critico";

  if (aceptacionMin != null && valor < aceptacionMin) return "fuera_aceptacion";
  if (aceptacionMax != null && valor > aceptacionMax) return "fuera_aceptacion";

  return "dentro";
}

// Texto breve del rango objetivo para mostrar junto al campo (ej. "72–78 g",
// "≥ 20 °C", "objetivo 75 g"). Devuelve null si no hay nada que mostrar.
export function formatearRango(spec: EspecLimites, unidad?: string): string | null {
  const u = unidad ? ` ${unidad}` : "";
  const { objetivo, aceptacionMin: min, aceptacionMax: max } = spec;
  if (min != null && max != null) return `${min}–${max}${u}`;
  if (min != null) return `≥ ${min}${u}`;
  if (max != null) return `≤ ${max}${u}`;
  if (objetivo != null) return `objetivo ${objetivo}${u}`;
  return null;
}
