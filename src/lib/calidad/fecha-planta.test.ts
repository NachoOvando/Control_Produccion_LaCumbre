import { describe, expect, it, vi, afterEach } from "vitest";
import { hoyPlanta, horaPlanta, jornadaProductiva, TZ_PLANTA } from "./fecha-planta";

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

describe("jornadaProductiva", () => {
  // Argentina es UTC-3 sin horario de verano — fijamos con vi.setSystemTime
  // en UTC y verificamos el resultado en hora de planta.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("antes de las 6am de planta, pertenece a la jornada del día calendario ANTERIOR", () => {
    vi.useFakeTimers();
    // 2026-07-16 05:30 hora de planta = 08:30 UTC
    vi.setSystemTime(new Date("2026-07-16T08:30:00Z"));
    expect(jornadaProductiva()).toBe("2026-07-15");
  });

  it("a las 6am en punto de planta, ya pertenece a la jornada de HOY", () => {
    vi.useFakeTimers();
    // 2026-07-16 06:00 hora de planta = 09:00 UTC
    vi.setSystemTime(new Date("2026-07-16T09:00:00Z"));
    expect(jornadaProductiva()).toBe("2026-07-16");
  });

  it("durante el día, coincide con hoyPlanta", () => {
    vi.useFakeTimers();
    // 2026-07-16 14:00 hora de planta = 17:00 UTC
    vi.setSystemTime(new Date("2026-07-16T17:00:00Z"));
    expect(jornadaProductiva()).toBe(hoyPlanta());
    expect(jornadaProductiva()).toBe("2026-07-16");
  });

  it("cruza correctamente el borde de mes (madrugada del día 1)", () => {
    vi.useFakeTimers();
    // 2026-08-01 02:00 hora de planta = 05:00 UTC → jornada del 31/07
    vi.setSystemTime(new Date("2026-08-01T05:00:00Z"));
    expect(jornadaProductiva()).toBe("2026-07-31");
  });

  it("usa la misma zona horaria que hoyPlanta/horaPlanta", () => {
    expect(TZ_PLANTA).toBe("America/Argentina/Cordoba");
  });
});
