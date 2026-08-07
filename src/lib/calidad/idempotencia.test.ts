import { describe, it, expect } from "vitest";
import { huellaDeBatch, clavesDeCaptura, type RegistroParaHuella } from "./idempotencia";

function registro(overrides: Partial<RegistroParaHuella> = {}): RegistroParaHuella {
  return {
    puntoControlId: "11111111-1111-1111-1111-111111111111",
    loteId: "22222222-2222-2222-2222-222222222222",
    lineaProductivaId: "33333333-3333-3333-3333-333333333333",
    fecha: "2026-08-07",
    data: { mediciones: [72.1, 73.4, 74.0] },
    ...overrides,
  };
}

// Generador determinista: uuid-1, uuid-2, ...
function uuidSecuencial() {
  let n = 0;
  return () => `uuid-${++n}`;
}

describe("huellaDeBatch", () => {
  it("la hora NO entra en la huella — es el caso que rompía la idempotencia", () => {
    // Los formularios recalculan `hora` al enviar, así que el reintento 40 s
    // después trae otra hora para el mismo dato capturado. Si la huella
    // dependiera de la hora, ningún reintento real sería reconocido.
    const a = { ...registro(), hora: "10:15:00" } as RegistroParaHuella;
    const b = { ...registro(), hora: "10:15:40" } as RegistroParaHuella;
    expect(huellaDeBatch([a])).toBe(huellaDeBatch([b]));
  });

  it("nroMuestra NO entra en la huella — lo reasigna el servidor", () => {
    const a = { ...registro(), nroMuestra: 3 } as RegistroParaHuella;
    const b = { ...registro(), nroMuestra: 7 } as RegistroParaHuella;
    expect(huellaDeBatch([a])).toBe(huellaDeBatch([b]));
  });

  it("un cambio en una medición SÍ cambia la huella", () => {
    const a = registro({ data: { mediciones: [72.1, 73.4] } });
    const b = registro({ data: { mediciones: [72.1, 73.5] } });
    expect(huellaDeBatch([a])).not.toBe(huellaDeBatch([b]));
  });

  it("el orden de las claves del data no afecta la huella", () => {
    const a = registro({ data: { tipo: "con_bano", mediciones: [72.1] } });
    const b = registro({ data: { mediciones: [72.1], tipo: "con_bano" } });
    expect(huellaDeBatch([a])).toBe(huellaDeBatch([b]));
  });

  it("el orden de un array SÍ importa: la posición es el pico dosificador", () => {
    const a = registro({ data: { mediciones: [72.1, 73.4] } });
    const b = registro({ data: { mediciones: [73.4, 72.1] } });
    expect(huellaDeBatch([a])).not.toBe(huellaDeBatch([b]));
  });

  it("distingue filas de la misma muestra por filaProd", () => {
    const a = registro({ filaProd: 1 });
    const b = registro({ filaProd: 2 });
    expect(huellaDeBatch([a])).not.toBe(huellaDeBatch([b]));
  });

  it("un cambio de fecha SÍ cambia la huella", () => {
    expect(huellaDeBatch([registro({ fecha: "2026-08-07" })])).not.toBe(
      huellaDeBatch([registro({ fecha: "2026-08-08" })])
    );
  });

  it("anida: un cambio dentro de un objeto del data cambia la huella", () => {
    const a = registro({ data: { filas: [{ peso_neto: 80 }] } });
    const b = registro({ data: { filas: [{ peso_neto: 81 }] } });
    expect(huellaDeBatch([a])).not.toBe(huellaDeBatch([b]));
  });
});

describe("clavesDeCaptura", () => {
  it("genera una clave por registro, no una por batch", () => {
    const batch = [registro({ filaProd: 1 }), registro({ filaProd: 2 }), registro({ filaProd: 3 })];
    const r = clavesDeCaptura(batch, null, uuidSecuencial());
    expect(r.claves).toEqual(["uuid-1", "uuid-2", "uuid-3"]);
  });

  it("reintento del mismo contenido reusa las claves (idempotencia real)", () => {
    const batch = [registro()];
    const primera = clavesDeCaptura(batch, null, uuidSecuencial());
    // El reintento pasa por acá con las claves previas y otro generador: si
    // generara de nuevo, el servidor no reconocería el evento.
    const segunda = clavesDeCaptura(batch, primera, uuidSecuencial());
    expect(segunda.claves).toEqual(primera.claves);
  });

  it("reintento con la hora recalculada TAMBIÉN reusa las claves", () => {
    const primerIntento = [{ ...registro(), hora: "10:15:00" } as RegistroParaHuella];
    const reintento = [{ ...registro(), hora: "10:15:40" } as RegistroParaHuella];
    const primera = clavesDeCaptura(primerIntento, null, uuidSecuencial());
    const segunda = clavesDeCaptura(reintento, primera, uuidSecuencial());
    expect(segunda.claves).toEqual(primera.claves);
  });

  it("si el operario corrige un valor, genera claves NUEVAS", () => {
    // Sin esto, el servidor responderría "ya existe" y la corrección se
    // perdería en silencio — el peor resultado posible.
    //
    // El generador se comparte entre las dos llamadas a propósito: con uno
    // nuevo por llamada, ambas devolverían "uuid-1" y el test no podría
    // distinguir una clave regenerada de una reusada.
    const gen = uuidSecuencial();
    const original = [registro({ data: { mediciones: [72.1] } })];
    const corregido = [registro({ data: { mediciones: [82.1] } })];
    const primera = clavesDeCaptura(original, null, gen);
    const segunda = clavesDeCaptura(corregido, primera, gen);
    expect(primera.claves).toEqual(["uuid-1"]);
    expect(segunda.claves).toEqual(["uuid-2"]);
  });

  it("si cambia la cantidad de registros, genera claves nuevas", () => {
    const gen = uuidSecuencial();
    const uno = [registro({ filaProd: 1 })];
    const dos = [registro({ filaProd: 1 }), registro({ filaProd: 2 })];
    const primera = clavesDeCaptura(uno, null, gen);
    const segunda = clavesDeCaptura(dos, primera, gen);
    expect(segunda.claves).toEqual(["uuid-2", "uuid-3"]);
    expect(segunda.claves).not.toContain(primera.claves[0]);
  });

  it("por defecto produce UUIDs válidos", () => {
    const r = clavesDeCaptura([registro()], null);
    expect(r.claves[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
