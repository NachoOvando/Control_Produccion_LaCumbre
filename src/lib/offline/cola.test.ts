import { describe, it, expect, vi } from "vitest";
import {
  encolar,
  drenar,
  estadoDeCola,
  tocaReintentar,
  ordenarParaEnviar,
  puedeCerrarTurno,
  esperaTrasIntentos,
  UMBRAL_ALERTA_MS,
  MAX_ENTRADAS,
} from "./cola";
import type { ColaStore, EntradaCola, RegistroPendiente, ResultadoIntento } from "./tipos";

// ── Dobles de los tres puertos ───────────────────────────────────────────────
//
// Sin JSDOM, sin IndexedDB, sin fetch: la política se testea completa porque no
// importa ninguna de esas cosas.

function storeEnMemoria(iniciales: EntradaCola[] = []): ColaStore & { datos: Map<string, EntradaCola> } {
  const datos = new Map(iniciales.map((e) => [e.id, e]));
  return {
    datos,
    async listar() {
      return [...datos.values()];
    },
    async guardar(e) {
      datos.set(e.id, e);
    },
    async borrar(id) {
      datos.delete(id);
    },
    async contar() {
      return datos.size;
    },
  };
}

function relojFijo(t = 1_000_000) {
  let actual = t;
  return {
    ahora: () => actual,
    avanzar: (ms: number) => {
      actual += ms;
    },
  };
}

function registro(overrides: Partial<RegistroPendiente> = {}): RegistroPendiente {
  return {
    clientRequestId: "aaaaaaaa-0000-4000-8000-000000000001",
    puntoControlId: "pc-1",
    loteId: "lote-1",
    lineaProductivaId: "linea-1",
    fecha: "2026-08-07",
    hora: "10:15:00",
    nroMuestra: 1,
    data: { mediciones: [72.1] },
    ...overrides,
  };
}

function entrada(overrides: Partial<EntradaCola> = {}): EntradaCola {
  return {
    id: "e1",
    registros: [registro()],
    capturadoEn: 1_000_000,
    intentos: 0,
    ultimoIntentoEn: null,
    ultimoError: null,
    bloqueada: false,
    ...overrides,
  };
}

function transporteQue(...resultados: ResultadoIntento[]) {
  const enviar = vi.fn<(r: RegistroPendiente[], c: { capturadoEn: number }) => Promise<ResultadoIntento>>();
  for (const r of resultados) enviar.mockResolvedValueOnce(r);
  enviar.mockResolvedValue(resultados[resultados.length - 1] ?? { estado: "ok" });
  return { transporte: { enviar }, enviar };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("encolar", () => {
  it("encola una muestra completa como UNA unidad de trabajo", async () => {
    // El batch del servidor es atómico: 12 filas suben juntas o no suben. Si se
    // encolaran fila por fila, un corte a mitad de sincronización dejaría media
    // muestra en la base.
    const store = storeEnMemoria();
    const reloj = relojFijo();
    const filas = [1, 2, 3].map((i) => registro({ clientRequestId: `id-${i}`, filaProd: i }));

    const r = await encolar(filas, { store, transporte: transporteQue().transporte, reloj, generarId: () => "e1" });

    expect(r).toEqual({ ok: true, id: "e1" });
    expect(store.datos.size).toBe(1);
    expect(store.datos.get("e1")!.registros).toHaveLength(3);
  });

  it("sella el instante de captura con el reloj inyectado", async () => {
    const store = storeEnMemoria();
    const reloj = relojFijo(555);
    await encolar([registro()], { store, transporte: transporteQue().transporte, reloj, generarId: () => "e1" });
    expect(store.datos.get("e1")!.capturadoEn).toBe(555);
  });

  it("rechaza encolar con la cola llena en vez de perder el dato en silencio", async () => {
    const llena = Array.from({ length: MAX_ENTRADAS }, (_, i) => entrada({ id: `e${i}` }));
    const store = storeEnMemoria(llena);
    const r = await encolar([registro()], {
      store,
      transporte: transporteQue().transporte,
      reloj: relojFijo(),
    });
    expect(r).toEqual({ ok: false, motivo: "cola_llena" });
    expect(store.datos.size).toBe(MAX_ENTRADAS);
  });
});

describe("ordenarParaEnviar", () => {
  it("ordena por instante de CAPTURA, no por orden de encolado", () => {
    // Es lo que hace que los correlativos que asigna el servidor queden en el
    // mismo orden en que se tomaron las muestras. Al revés, un export ordenado
    // por correlativo mostraría 10:15 antes de 09:40 — hallazgo de auditoría por
    // sí solo, aunque los datos estén bien.
    const tarde = entrada({ id: "tarde", capturadoEn: 3000 });
    const temprano = entrada({ id: "temprano", capturadoEn: 1000 });
    const medio = entrada({ id: "medio", capturadoEn: 2000 });
    expect(ordenarParaEnviar([tarde, temprano, medio]).map((e) => e.id)).toEqual([
      "temprano",
      "medio",
      "tarde",
    ]);
  });

  it("no muta el array de entrada", () => {
    const lista = [entrada({ id: "b", capturadoEn: 2 }), entrada({ id: "a", capturadoEn: 1 })];
    ordenarParaEnviar(lista);
    expect(lista.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("tocaReintentar", () => {
  it("una entrada nueva se intenta enseguida", () => {
    expect(tocaReintentar(entrada(), 1_000_000)).toBe(true);
  });

  it("respeta el backoff tras un fallo", () => {
    const e = entrada({ intentos: 1, ultimoIntentoEn: 1_000_000 });
    expect(tocaReintentar(e, 1_000_000 + esperaTrasIntentos(1) - 1)).toBe(false);
    expect(tocaReintentar(e, 1_000_000 + esperaTrasIntentos(1))).toBe(true);
  });

  it("el backoff se aplana y no crece sin límite", () => {
    expect(esperaTrasIntentos(3)).toBe(300_000);
    expect(esperaTrasIntentos(50)).toBe(300_000);
  });

  it("una entrada bloqueada NO se reintenta nunca sola", () => {
    expect(tocaReintentar(entrada({ bloqueada: true }), 9_999_999_999)).toBe(false);
  });
});

describe("drenar", () => {
  it("sube y borra en el camino feliz", async () => {
    const store = storeEnMemoria([entrada()]);
    const { transporte, enviar } = transporteQue({ estado: "ok" });
    const r = await drenar({ store, transporte, reloj: relojFijo() });
    expect(r.enviadas).toBe(1);
    expect(store.datos.size).toBe(0);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("CORTA en el primer fallo de red en vez de recorrer toda la cola", async () => {
    // Si no hay red, el resto va a fallar igual. Seguir intentando consume
    // batería y —lo importante— le suma un intento a TODAS las entradas, lo que
    // las empuja al backoff largo justo cuando la red vuelva.
    const store = storeEnMemoria([
      entrada({ id: "e1", capturadoEn: 1 }),
      entrada({ id: "e2", capturadoEn: 2 }),
      entrada({ id: "e3", capturadoEn: 3 }),
    ]);
    const { transporte, enviar } = transporteQue({ estado: "sin_red" });
    const r = await drenar({ store, transporte, reloj: relojFijo() });

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r.cortadoPorRed).toBe(true);
    expect(store.datos.get("e1")!.intentos).toBe(1);
    // Las otras dos NO fueron penalizadas con un intento.
    expect(store.datos.get("e2")!.intentos).toBe(0);
    expect(store.datos.get("e3")!.intentos).toBe(0);
  });

  it("un rechazo definitivo NO corta el drenado y NO borra el registro", async () => {
    // Es un problema de esa entrada, no de la conexión. Y borrarla sería perder
    // un dato de calidad que alguien capturó, para simplificar la cola.
    const store = storeEnMemoria([
      entrada({ id: "mala", capturadoEn: 1 }),
      entrada({ id: "buena", capturadoEn: 2 }),
    ]);
    const { transporte } = transporteQue({ estado: "rechazado", motivo: "Lote no encontrado" }, { estado: "ok" });
    const r = await drenar({ store, transporte, reloj: relojFijo() });

    expect(r.bloqueadas).toBe(1);
    expect(r.enviadas).toBe(1);
    expect(store.datos.has("mala")).toBe(true);
    expect(store.datos.get("mala")!.bloqueada).toBe(true);
    expect(store.datos.get("mala")!.ultimoError).toBe("Lote no encontrado");
    expect(store.datos.has("buena")).toBe(false);
  });

  it("salta las entradas cuyo backoff todavía no venció", async () => {
    const reloj = relojFijo();
    const store = storeEnMemoria([
      entrada({ id: "esperando", intentos: 2, ultimoIntentoEn: reloj.ahora() }),
      entrada({ id: "lista", capturadoEn: 5 }),
    ]);
    const { transporte, enviar } = transporteQue({ estado: "ok" });
    await drenar({ store, transporte, reloj });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(store.datos.has("esperando")).toBe(true);
    expect(store.datos.has("lista")).toBe(false);
  });

  it("no intenta nada con la cola vacía", async () => {
    const { transporte, enviar } = transporteQue({ estado: "ok" });
    const r = await drenar({ store: storeEnMemoria(), transporte, reloj: relojFijo() });
    expect(enviar).not.toHaveBeenCalled();
    expect(r).toEqual({ enviadas: 0, fallidas: 0, bloqueadas: 0, cortadoPorRed: false });
  });

  it("un reintento tras el backoff sube y limpia la entrada", async () => {
    const reloj = relojFijo();
    const store = storeEnMemoria([entrada()]);
    const sinRed = transporteQue({ estado: "sin_red" });
    await drenar({ store, transporte: sinRed.transporte, reloj });
    expect(store.datos.size).toBe(1);

    reloj.avanzar(esperaTrasIntentos(1));
    const ok = transporteQue({ estado: "ok" });
    const r2 = await drenar({ store, transporte: ok.transporte, reloj });
    expect(r2.enviadas).toBe(1);
    expect(store.datos.size).toBe(0);
  });
});

describe("estadoDeCola", () => {
  it("separa pendientes de bloqueadas", () => {
    const e = estadoDeCola([entrada({ id: "a" }), entrada({ id: "b", bloqueada: true })], 1_000_000);
    expect(e.pendientes).toBe(1);
    expect(e.bloqueadas).toBe(1);
  });

  it("la antigüedad es la de la entrada MÁS VIEJA", () => {
    const ahora = 1_000_000;
    const e = estadoDeCola(
      [entrada({ id: "a", capturadoEn: ahora - 5000 }), entrada({ id: "b", capturadoEn: ahora - 60_000 })],
      ahora
    );
    expect(e.antiguedadMaximaMs).toBe(60_000);
  });

  it("alerta al pasar el umbral de acción operativa (60 min)", () => {
    const ahora = 10_000_000;
    expect(estadoDeCola([entrada({ capturadoEn: ahora - UMBRAL_ALERTA_MS + 1 })], ahora).requiereAlerta).toBe(false);
    expect(estadoDeCola([entrada({ capturadoEn: ahora - UMBRAL_ALERTA_MS })], ahora).requiereAlerta).toBe(true);
  });

  it("las bloqueadas NO cuentan para la antigüedad ni para la alerta", () => {
    const ahora = 10_000_000;
    const e = estadoDeCola([entrada({ bloqueada: true, capturadoEn: ahora - UMBRAL_ALERTA_MS * 5 })], ahora);
    expect(e.antiguedadMaximaMs).toBeNull();
    expect(e.requiereAlerta).toBe(false);
  });

  it("un reloj del dispositivo movido hacia adelante no produce antigüedad negativa", () => {
    // La captura quedó sellada con un reloj adelantado respecto de ahora. Se acota
    // a 0 en vez de mostrar un número absurdo; el desvío real lo evalúa el
    // servidor contra su propio created_at.
    const e = estadoDeCola([entrada({ capturadoEn: 2_000_000 })], 1_000_000);
    expect(e.antiguedadMaximaMs).toBe(0);
    expect(e.requiereAlerta).toBe(false);
  });

  it("cola vacía: sin antigüedad y sin alerta", () => {
    expect(estadoDeCola([], 1_000_000)).toEqual({
      pendientes: 0,
      bloqueadas: 0,
      antiguedadMaximaMs: null,
      requiereAlerta: false,
    });
  });
});

describe("puedeCerrarTurno", () => {
  it("bloquea el cierre con muestras sin subir", () => {
    const r = puedeCerrarTurno({ pendientes: 3, bloqueadas: 0, antiguedadMaximaMs: 1000, requiereAlerta: false });
    expect(r.puede).toBe(false);
    expect(r.motivo).toContain("3 muestras sin subir");
    expect(r.motivo).toContain("no se libera producto");
  });

  it("singulariza el mensaje con una sola muestra", () => {
    const r = puedeCerrarTurno({ pendientes: 1, bloqueadas: 0, antiguedadMaximaMs: 1, requiereAlerta: false });
    expect(r.motivo).toContain("1 muestra sin subir");
  });

  it("bloquea también con muestras rechazadas y manda a supervisión", () => {
    const r = puedeCerrarTurno({ pendientes: 0, bloqueadas: 2, antiguedadMaximaMs: null, requiereAlerta: false });
    expect(r.puede).toBe(false);
    expect(r.motivo).toContain("supervisión de calidad");
  });

  it("permite cerrar con la cola drenada", () => {
    expect(
      puedeCerrarTurno({ pendientes: 0, bloqueadas: 0, antiguedadMaximaMs: null, requiereAlerta: false })
    ).toEqual({ puede: true });
  });
});
