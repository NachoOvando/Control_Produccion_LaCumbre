import { describe, expect, it } from "vitest";
import { generarLotePT, calcularVencimiento } from "./lote-pt";

describe("generarLotePT", () => {
  const fecha = new Date(2026, 6, 15); // 15 de julio 2026, mes 0-indexed

  it("reemplaza {yyyyMMdd} y {correlativo} (template Arcor)", () => {
    expect(generarLotePT("L{yyyyMMdd}-{correlativo}", fecha, 3)).toBe("L20260715-03");
  });

  it("reemplaza {ddMMyy} (template marca propia)", () => {
    expect(generarLotePT("LC{ddMMyy}-{correlativo}", fecha, 12)).toBe("LC150726-12");
  });

  it("padea el correlativo a 2 dígitos pero no trunca 3 dígitos", () => {
    expect(generarLotePT("L{yyyyMMdd}-{correlativo}", fecha, 7)).toBe("L20260715-07");
    expect(generarLotePT("L{yyyyMMdd}-{correlativo}", fecha, 123)).toBe("L20260715-123");
  });
});

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
