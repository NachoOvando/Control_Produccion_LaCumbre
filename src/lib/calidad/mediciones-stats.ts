// Estadística descriptiva de un array de mediciones — lógica pura, testeable sin
// React. La usa PesoOppForm para el promedio/dispersión en vivo de los 10 pesos.
//
// Es la misma lógica que `calcularStats` en PesoMedicionesForm.tsx:99-117.
// Duplicación consciente y acotada: extraerla de ahí implicaría tocar un archivo
// de 1190 líneas con un submodo ya frágil (ADR-016), y este cambio no lo
// necesita. Follow-up anotado: unificar cuando haya que tocar ese archivo por
// otro motivo.
//
// Acepta strings porque los inputs del formulario guardan strings ("" mientras
// la celda está vacía). Lo que no parsea a número finito se IGNORA, no cuenta
// como 0 — una celda vacía no es un peso de cero.

export type StatsMediciones = {
  n: number;
  promedio: number;
  min: number;
  max: number;
  amplitud: number;
  desvio: number;
};

export function estadisticasMediciones(
  valores: readonly (string | number | null | undefined)[]
): StatsMediciones | null {
  const vals: number[] = [];
  for (const v of valores) {
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(v);
    if (Number.isFinite(n)) vals.push(n);
  }

  if (vals.length === 0) return null;

  const n = vals.length;
  const promedio = vals.reduce((a, b) => a + b, 0) / n;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  // Desvío poblacional (divide por n, no por n-1): la muestra ES la población
  // que se controla en esa hora, igual criterio que calcularStats.
  const varianza = vals.reduce((acc, v) => acc + (v - promedio) ** 2, 0) / n;

  return { n, promedio, min, max, amplitud: max - min, desvio: Math.sqrt(varianza) };
}
