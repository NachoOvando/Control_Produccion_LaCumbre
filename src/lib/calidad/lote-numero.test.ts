import { describe, expect, it } from "vitest";
import { generarNumeroLote } from "./lote-numero";

describe("generarNumeroLote", () => {
  it("arma el formato L-DD/MM/AAAA-AJJJ-hh:mm-ENV", () => {
    // Producido 2026-07-16 (día juliano 197, año termina en 6) en Línea 3,
    // vida útil 4 meses → vence 2026-11-16.
    const numero = generarNumeroLote({
      fechaProduccion: new Date(2026, 6, 16),
      vidaUtilMeses: 4,
      lineaCodigo: 3,
      horaRegistro: "14:32",
    });
    expect(numero).toBe("L-16/11/2026-6197-14:32-3");
  });

  it("el día juliano del 1 de enero es 001", () => {
    const numero = generarNumeroLote({
      fechaProduccion: new Date(2026, 0, 1),
      vidaUtilMeses: 1,
      lineaCodigo: 0,
      horaRegistro: "08:00",
    });
    expect(numero).toContain("-6001-");
  });

  it("el día juliano del 31 de diciembre es 365 (año no bisiesto)", () => {
    const numero = generarNumeroLote({
      fechaProduccion: new Date(2026, 11, 31),
      vidaUtilMeses: 1,
      lineaCodigo: 1,
      horaRegistro: "08:00",
    });
    expect(numero).toContain("-6365-");
  });

  it("el día juliano del 31 de diciembre es 366 en año bisiesto", () => {
    const numero = generarNumeroLote({
      fechaProduccion: new Date(2028, 11, 31),
      vidaUtilMeses: 1,
      lineaCodigo: 1,
      horaRegistro: "08:00",
    });
    expect(numero).toContain("-8366-");
  });

  it("agrega el sufijo de desambiguación cuando se pasa (reintento por colisión)", () => {
    const numero = generarNumeroLote({
      fechaProduccion: new Date(2026, 6, 16),
      vidaUtilMeses: 4,
      lineaCodigo: 3,
      horaRegistro: "14:32",
      sufijo: "-02",
    });
    expect(numero).toBe("L-16/11/2026-6197-14:32-3-02");
  });

  it("dos llamadas con los mismos inputs son deterministas (mismo string)", () => {
    const input = { fechaProduccion: new Date(2026, 6, 16), vidaUtilMeses: 4, lineaCodigo: 3, horaRegistro: "14:32" };
    expect(generarNumeroLote(input)).toBe(generarNumeroLote(input));
  });

  it("propaga el throw de vidaUtilMeses inválida (delegado a calcularFechaVencimiento)", () => {
    expect(() =>
      generarNumeroLote({ fechaProduccion: new Date(), vidaUtilMeses: 0, lineaCodigo: 3, horaRegistro: "08:00" })
    ).toThrow();
  });
});
