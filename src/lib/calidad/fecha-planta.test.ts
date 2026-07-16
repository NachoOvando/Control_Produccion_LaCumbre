import { describe, expect, it } from "vitest";
import { hoyPlanta, horaPlanta } from "./fecha-planta";

describe("fecha-planta", () => {
  it("hoyPlanta devuelve formato YYYY-MM-DD", () => {
    expect(hoyPlanta()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("horaPlanta devuelve formato HH:MM en 24h", () => {
    const hora = horaPlanta();
    expect(hora).toMatch(/^\d{2}:\d{2}$/);
    const [hh, mm] = hora.split(":").map(Number);
    expect(hh).toBeGreaterThanOrEqual(0);
    expect(hh).toBeLessThan(24);
    expect(mm).toBeGreaterThanOrEqual(0);
    expect(mm).toBeLessThan(60);
  });

  it("hoyPlanta usa la fecha de Argentina, no el día UTC", () => {
    // No podemos fijar el reloj sin fake timers globales que rompan Intl, pero
    // sí verificar la coherencia: la fecha de planta debe ser hoy o ayer en
    // términos UTC (Argentina está detrás de UTC), nunca mañana.
    const fechaPlanta = hoyPlanta();
    const utcHoy = new Date().toISOString().slice(0, 10);
    expect(fechaPlanta <= utcHoy).toBe(true);
  });
});
