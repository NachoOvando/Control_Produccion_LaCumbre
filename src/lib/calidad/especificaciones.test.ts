import { describe, expect, it } from "vitest";
import {
  evaluarValor,
  formatearRango,
  estadoVisible,
  formatearRangoVisible,
  formatearRangoCritico,
} from "./especificaciones";

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

// ─────────────────────────────────────────────────────────────────────────────
// Política de visibilidad en dos capas (D5)
// ─────────────────────────────────────────────────────────────────────────────

describe("estadoVisible — política de dos capas", () => {
  // Alfajor Negro: la única spec real cargada en la base.
  const spec = { objetivo: 75, aceptacionMin: 72, aceptacionMax: 78, criticoMin: 68, criticoMax: 82 };

  describe("mientras el operario tipea (capturando)", () => {
    it("un valor dentro de aceptación NO muestra nada", () => {
      // Si mostrara verde, el operario sabría que ya está "bien" y dejaría de
      // reportar el valor real.
      expect(estadoVisible(75, spec, "capturando")).toBeNull();
    });

    it("un valor fuera de aceptación TAMPOCO muestra nada", () => {
      // Es el caso clave: ámbar en vivo le dice "movete hacia el centro".
      expect(estadoVisible(70, spec, "capturando")).toBeNull();
      expect(estadoVisible(80, spec, "capturando")).toBeNull();
    });

    it("dentro y fuera_aceptacion son INDISTINGUIBLES — no se puede inferir la dirección", () => {
      expect(estadoVisible(75, spec, "capturando")).toBe(estadoVisible(70, spec, "capturando"));
    });

    it("fuera del límite crítico SÍ se muestra, siempre", () => {
      // Cruzar el crítico dispara retención y parada: ocultarlo sería peor.
      expect(estadoVisible(67, spec, "capturando")).toBe("fuera_critico");
      expect(estadoVisible(83, spec, "capturando")).toBe("fuera_critico");
    });
  });

  describe("con la muestra completa", () => {
    it("revela la evaluación completa del conjunto", () => {
      expect(estadoVisible(75, spec, "completa")).toBe("dentro");
      expect(estadoVisible(70, spec, "completa")).toBe("fuera_aceptacion");
      expect(estadoVisible(83, spec, "completa")).toBe("fuera_critico");
    });
  });

  it("sin spec cargada no muestra nada en ninguna fase", () => {
    expect(estadoVisible(75, {}, "capturando")).toBeNull();
    expect(estadoVisible(75, {}, "completa")).toBeNull();
  });

  it("una spec SOLO con aceptación queda invisible durante la captura", () => {
    // Consecuencia deliberada: sin límite crítico cargado no hay nada que
    // mostrar en vivo. Es el estado de casi todos los parámetros hoy.
    const soloAceptacion = { aceptacionMin: 72, aceptacionMax: 78 };
    expect(estadoVisible(70, soloAceptacion, "capturando")).toBeNull();
    expect(estadoVisible(70, soloAceptacion, "completa")).toBe("fuera_aceptacion");
  });

  it("una spec SOLO con crítico se comporta igual en las dos fases", () => {
    const soloCritico = { criticoMin: 68, criticoMax: 82 };
    expect(estadoVisible(67, soloCritico, "capturando")).toBe("fuera_critico");
    expect(estadoVisible(67, soloCritico, "completa")).toBe("fuera_critico");
    expect(estadoVisible(75, soloCritico, "capturando")).toBeNull();
  });
});

describe("formatearRangoVisible — el rango escrito es el ancla más fuerte", () => {
  const spec = { objetivo: 75, aceptacionMin: 72, aceptacionMax: 78, criticoMin: 68, criticoMax: 82 };

  it("durante la captura NO revela el rango de aceptación, solo el crítico", () => {
    const texto = formatearRangoVisible(spec, "g", "capturando");
    expect(texto).toBe("crítico 68–82 g");
    expect(texto).not.toContain("72");
    expect(texto).not.toContain("78");
  });

  it("con la muestra completa muestra el objetivo", () => {
    expect(formatearRangoVisible(spec, "g", "completa")).toBe("objetivo 72–78 g");
  });

  it("sin límite crítico, durante la captura no muestra ningún rango", () => {
    expect(formatearRangoVisible({ aceptacionMin: 72, aceptacionMax: 78 }, "g", "capturando")).toBeNull();
  });

  it("con la muestra completa cae al crítico si no hay rango de aceptación ni objetivo", () => {
    expect(formatearRangoVisible({ criticoMin: 68, criticoMax: 82 }, "g", "completa")).toBe("crítico 68–82 g");
  });

  it("formatearRangoCritico soporta cotas asimétricas", () => {
    expect(formatearRangoCritico({ criticoMin: 20 }, "°C")).toBe("crítico ≥ 20 °C");
    expect(formatearRangoCritico({ criticoMax: 82 }, "g")).toBe("crítico ≤ 82 g");
    expect(formatearRangoCritico({}, "g")).toBeNull();
  });
});
