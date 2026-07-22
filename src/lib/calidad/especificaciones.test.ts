import { describe, expect, it } from "vitest";
import { evaluarValor, formatearRango } from "./especificaciones";

describe("evaluarValor", () => {
  const spec = { aceptacionMin: 72, aceptacionMax: 78, criticoMin: 68, criticoMax: 82 };

  it("dentro del rango de aceptación → dentro", () => {
    expect(evaluarValor(75, spec)).toBe("dentro");
  });

  it("bordes del rango de aceptación son inclusivos", () => {
    expect(evaluarValor(72, spec)).toBe("dentro");
    expect(evaluarValor(78, spec)).toBe("dentro");
  });

  it("fuera de aceptación pero dentro de crítico → fuera_aceptacion", () => {
    expect(evaluarValor(70, spec)).toBe("fuera_aceptacion");
    expect(evaluarValor(80, spec)).toBe("fuera_aceptacion");
  });

  it("bordes del rango crítico son inclusivos (siguen siendo fuera_aceptacion)", () => {
    expect(evaluarValor(68, spec)).toBe("fuera_aceptacion");
    expect(evaluarValor(82, spec)).toBe("fuera_aceptacion");
  });

  it("fuera del rango crítico → fuera_critico", () => {
    expect(evaluarValor(67, spec)).toBe("fuera_critico");
    expect(evaluarValor(83, spec)).toBe("fuera_critico");
  });

  it("min y max independientes: solo max definido", () => {
    const soloMax = { aceptacionMax: 78 };
    expect(evaluarValor(50, soloMax)).toBe("dentro"); // sin piso, cualquier valor bajo entra
    expect(evaluarValor(79, soloMax)).toBe("fuera_aceptacion");
  });

  it("solo min definido", () => {
    const soloMin = { aceptacionMin: 72 };
    expect(evaluarValor(1000, soloMin)).toBe("dentro"); // sin techo
    expect(evaluarValor(71, soloMin)).toBe("fuera_aceptacion");
  });

  it("sin ningún límite → sin_spec", () => {
    expect(evaluarValor(75, {})).toBe("sin_spec");
    expect(evaluarValor(75, { objetivo: 75 })).toBe("sin_spec"); // objetivo solo no evalúa
  });

  it("valor no finito → sin_spec", () => {
    expect(evaluarValor(NaN, spec)).toBe("sin_spec");
  });

  it("crítico sin aceptación: entre crítico → dentro; fuera → fuera_critico", () => {
    const soloCritico = { criticoMin: 68, criticoMax: 82 };
    expect(evaluarValor(75, soloCritico)).toBe("dentro");
    expect(evaluarValor(90, soloCritico)).toBe("fuera_critico");
  });
});

describe("formatearRango", () => {
  it("min y max → rango con unidad", () => {
    expect(formatearRango({ aceptacionMin: 72, aceptacionMax: 78 }, "g")).toBe("72–78 g");
  });
  it("solo min → ≥", () => {
    expect(formatearRango({ aceptacionMin: 20 }, "°C")).toBe("≥ 20 °C");
  });
  it("solo max → ≤", () => {
    expect(formatearRango({ aceptacionMax: 100 }, "%")).toBe("≤ 100 %");
  });
  it("solo objetivo → objetivo", () => {
    expect(formatearRango({ objetivo: 75 }, "g")).toBe("objetivo 75 g");
  });
  it("sin nada → null", () => {
    expect(formatearRango({})).toBeNull();
  });
  it("sin unidad no agrega sufijo", () => {
    expect(formatearRango({ aceptacionMin: 72, aceptacionMax: 78 })).toBe("72–78");
  });
});
