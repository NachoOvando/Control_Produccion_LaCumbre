import { describe, expect, it } from "vitest";
import { calcularCoberturaPorObservacion, promedioValido } from "./peso-cobertura";

describe("calcularCoberturaPorObservacion", () => {
  it("resta apareada por posición (con_baño - sin_bañar)", () => {
    expect(calcularCoberturaPorObservacion([10, 12], [13, 15])).toEqual([3, 3]);
  });

  it("posiciones con valores distintos dan diferencias distintas", () => {
    expect(calcularCoberturaPorObservacion([10, 20, 5], [13, 21, 9])).toEqual([3, 1, 4]);
  });

  it("posición incompleta (falta uno de los dos) da NaN, no rompe el resto", () => {
    const r = calcularCoberturaPorObservacion([10, NaN, 5], [13, 20, 9]);
    expect(r[0]).toBe(3);
    expect(Number.isNaN(r[1])).toBe(true);
    expect(r[2]).toBe(4);
  });

  it("arrays vacíos devuelven vacío", () => {
    expect(calcularCoberturaPorObservacion([], [])).toEqual([]);
  });

  it("puede dar cobertura negativa (tapa con baño pesó menos — caso real a detectar, no se descarta)", () => {
    expect(calcularCoberturaPorObservacion([10], [9])).toEqual([-1]);
  });
});

describe("promedioValido", () => {
  it("promedia ignorando NaN", () => {
    expect(promedioValido([2, NaN, 4])).toBe(3);
  });

  it("sin ningún valor válido devuelve null", () => {
    expect(promedioValido([NaN, NaN])).toBeNull();
  });

  it("array vacío devuelve null", () => {
    expect(promedioValido([])).toBeNull();
  });
});
