import { describe, it, expect } from "vitest";
import { estadisticasMediciones } from "./mediciones-stats";

describe("estadisticasMediciones", () => {
  it("calcula n, promedio, mín, máx, amplitud y desvío", () => {
    const s = estadisticasMediciones(["10", "12", "14"]);
    expect(s).not.toBeNull();
    expect(s!.n).toBe(3);
    expect(s!.promedio).toBeCloseTo(12, 6);
    expect(s!.min).toBe(10);
    expect(s!.max).toBe(14);
    expect(s!.amplitud).toBe(4);
    // Desvío poblacional: sqrt(((-2)² + 0² + 2²)/3) = sqrt(8/3)
    expect(s!.desvio).toBeCloseTo(Math.sqrt(8 / 3), 6);
  });

  it("acepta números además de strings", () => {
    const s = estadisticasMediciones([47.3, "47.5"]);
    expect(s!.n).toBe(2);
    expect(s!.promedio).toBeCloseTo(47.4, 6);
  });

  // Una celda vacía no es un peso de cero: si contara como 0, el promedio de una
  // muestra a medio cargar se hundiría y el indicador de spec mentiría.
  it("ignora celdas vacías, null y undefined en vez de contarlas como 0", () => {
    const s = estadisticasMediciones(["20", "", null, undefined, "22"]);
    expect(s!.n).toBe(2);
    expect(s!.promedio).toBeCloseTo(21, 6);
    expect(s!.min).toBe(20);
  });

  it("ignora lo que no parsea a número finito", () => {
    const s = estadisticasMediciones(["20", "abc", "NaN"]);
    expect(s!.n).toBe(1);
    expect(s!.promedio).toBe(20);
  });

  it("devuelve null cuando no hay ningún valor usable", () => {
    expect(estadisticasMediciones([])).toBeNull();
    expect(estadisticasMediciones(["", "", null])).toBeNull();
  });

  it("un solo valor da desvío 0 y amplitud 0", () => {
    const s = estadisticasMediciones(["47.3"]);
    expect(s!.n).toBe(1);
    expect(s!.desvio).toBe(0);
    expect(s!.amplitud).toBe(0);
  });
});
