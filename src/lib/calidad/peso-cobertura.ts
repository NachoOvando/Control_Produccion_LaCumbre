// Cálculo del peso de cobertura de tapas por resta apareada — lógica pura,
// sin dependencias de framework. Cada posición (pico dosificador 1-12) pesa la
// MISMA tapa dos veces: sin bañar y con baño. La diferencia da el peso de
// cobertura de chocolate para ese pico específico (ADR-015, corrección
// 2026-07-21 — reemplaza la 3ª fila manual "BAÑO" que no correspondía).
//
// Las 12 posiciones se calculan de forma independiente: si una posición no
// tiene ambos valores cargados, esa posición da NaN (no se completa con 0 ni
// se descarta la muestra completa) — el caller decide qué hacer con NaN
// (bloquear guardado, mostrar "—", etc.), esta función no valida completitud.

export function calcularCoberturaPorObservacion(tapa: number[], tapaConBano: number[]): number[] {
  const n = Math.max(tapa.length, tapaConBano.length);
  const resultado: number[] = [];
  for (let i = 0; i < n; i++) {
    const sin = tapa[i];
    const con = tapaConBano[i];
    resultado.push(Number.isFinite(sin) && Number.isFinite(con) ? con - sin : NaN);
  }
  return resultado;
}

// Promedio de los valores válidos (ignora NaN). Devuelve null si no hay ninguno.
export function promedioValido(valores: number[]): number | null {
  const validos = valores.filter((v) => Number.isFinite(v));
  if (validos.length === 0) return null;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}
