import { describe, expect, it } from "vitest";
import { calcularVencimiento, calcularFechaVencimiento } from "./lote-pt";

describe("calcularVencimiento", () => {
  it("suma meses de vida útil en formato MM/yyyy", () => {
    expect(calcularVencimiento(new Date(2026, 6, 15), 9)).toBe("04/2027");
  });

  it("no sufre overflow de setMonth con fecha 31 (31/05 + 9 meses = feb, no mar)", () => {
    expect(calcularVencimiento(new Date(2026, 4, 31), 9)).toBe("02/2027");
  });

  it("cruza el año correctamente", () => {
    expect(calcularVencimiento(new Date(2026, 11, 1), 4)).toBe("04/2027");
  });

  it("rechaza vida útil inválida", () => {
    expect(() => calcularVencimiento(new Date(), 0)).toThrow();
    expect(() => calcularVencimiento(new Date(), -3)).toThrow();
    expect(() => calcularVencimiento(new Date(), 1.5)).toThrow();
  });
});

describe("calcularFechaVencimiento", () => {
  it("preserva el día de producción en el mes destino", () => {
    const v = calcularFechaVencimiento(new Date(2026, 6, 16), 4); // 16/07/2026 + 4m
    expect(v.getFullYear()).toBe(2026);
    expect(v.getMonth()).toBe(10); // noviembre (0-indexed)
    expect(v.getDate()).toBe(16);
  });

  it("clampea al último día si el mes destino es más corto (31/01 + 1 mes → 28/02)", () => {
    const v = calcularFechaVencimiento(new Date(2026, 0, 31), 1);
    expect(v.getMonth()).toBe(1); // febrero
    expect(v.getDate()).toBe(28); // 2026 no es bisiesto
  });

  it("clampea a 29/02 en año bisiesto", () => {
    const v = calcularFechaVencimiento(new Date(2028, 0, 31), 1); // 2028 es bisiesto
    expect(v.getMonth()).toBe(1);
    expect(v.getDate()).toBe(29);
  });

  it("calcularVencimiento (MM/yyyy) sigue devolviendo el mismo mes que antes del refactor", () => {
    // Casos ya cubiertos arriba — confirma que el refactor sobre
    // calcularFechaVencimiento no cambió el comportamiento público existente.
    expect(calcularVencimiento(new Date(2026, 4, 31), 9)).toBe("02/2027");
  });
});
