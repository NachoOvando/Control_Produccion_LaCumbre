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

// ─────────────────────────────────────────────────────────────────────────────
// Política de visibilidad en DOS CAPAS
//
// Decidida por el usuario y auditada por scm-alimentos. El problema: mostrar el
// rango objetivo y el semáforo en vivo, medición por medición, es un incentivo
// estructural a "acomodar" el número hacia el centro del rango. Sobre `peso_neto`
// —que es contenido neto declarado, con exposición regulatoria de lealtad
// comercial además de contractual con Arcor— eso deja de ser un problema de
// calidad de dato y pasa a ser uno de INTEGRIDAD DE REGISTROS, que es de los
// hallazgos más caros que existen en una auditoría de segunda parte.
//
// Las dos capas:
//
//   CRÍTICO  → visible SIEMPRE y en vivo. Cruzar el límite crítico dispara
//              retención de producto y parada de línea: ocultarlo sería peor que
//              el sesgo que se quiere evitar.
//
//   OBJETIVO / ACEPTACIÓN → NO se muestran mientras el operario tipea. Se
//              revelan cuando la muestra está completa, como evaluación del
//              conjunto. Así no puede ir corrigiendo celda por celda hacia el
//              centro, pero sigue viendo el resultado y puede actuar sobre la
//              muestra SIGUIENTE — que es la ventana real de acción de un ajuste
//              de dosificador, no la celda siguiente.
//
// Ojo con lo que se oculta: no es solo el punto de color. El rango objetivo
// escrito al lado del campo ("objetivo 72–78 g") es el ancla más fuerte de las
// dos. Durante la captura solo se muestra el rango CRÍTICO, si está cargado.
//
// Esta política aplica a TODOS los puntos de control con especificación, no solo
// a los nuevos: es un cambio de comportamiento sobre los 5 formularios que hasta
// ahora mostraban todo en vivo.
// ─────────────────────────────────────────────────────────────────────────────

export type FaseMuestra =
  /** El operario está cargando. Solo se revela la capa crítica. */
  | "capturando"
  /** La muestra está completa. Se revela la evaluación del conjunto. */
  | "completa";

/**
 * Estado a MOSTRAR según la fase, o `null` si no corresponde mostrar nada.
 *
 * En `capturando` colapsa `dentro` y `fuera_aceptacion` a `null`: son
 * indistinguibles para el operario, que es justamente el punto — no puede
 * inferir hacia dónde mover el valor. `fuera_critico` sí pasa siempre.
 */
export function estadoVisible(
  valor: number,
  spec: EspecLimites,
  fase: FaseMuestra
): Exclude<EstadoSpec, "sin_spec"> | null {
  const estado = evaluarValor(valor, spec);
  if (estado === "sin_spec") return null;
  if (fase === "completa") return estado;
  return estado === "fuera_critico" ? "fuera_critico" : null;
}

/** Rango crítico en texto (ej. "crítico 68–82 g"). Null si no hay límite crítico. */
export function formatearRangoCritico(spec: EspecLimites, unidad?: string): string | null {
  const u = unidad ? ` ${unidad}` : "";
  const { criticoMin: min, criticoMax: max } = spec;
  if (min != null && max != null) return `crítico ${min}–${max}${u}`;
  if (min != null) return `crítico ≥ ${min}${u}`;
  if (max != null) return `crítico ≤ ${max}${u}`;
  return null;
}

/**
 * Texto de rango a mostrar según la fase. Durante la captura, SOLO el crítico
 * (el rango de aceptación es el ancla que hay que ocultar).
 */
export function formatearRangoVisible(
  spec: EspecLimites,
  unidad: string | undefined,
  fase: FaseMuestra
): string | null {
  if (fase === "completa") {
    const rango = formatearRango(spec, unidad);
    if (rango) return `objetivo ${rango}`;
    return formatearRangoCritico(spec, unidad);
  }
  return formatearRangoCritico(spec, unidad);
}
