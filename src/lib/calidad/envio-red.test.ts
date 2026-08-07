import { describe, it, expect, vi } from "vitest";
import { postConReintento, debeReintentar, esperaAntesDeIntento } from "./envio-red";

// Sin espera real: el test no debe tardar el backoff.
const sinDormir = () => Promise.resolve();

function respuesta(status: number, json: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  } as unknown as Response;
}

describe("debeReintentar", () => {
  it("reintenta ante falla de red", () => {
    expect(debeReintentar({ tipo: "red" })).toBe(true);
  });

  it("reintenta ante 5xx", () => {
    expect(debeReintentar({ tipo: "http", status: 500 })).toBe(true);
    expect(debeReintentar({ tipo: "http", status: 503 })).toBe(true);
  });

  it("NO reintenta ante 4xx — el mismo payload va a fallar igual", () => {
    expect(debeReintentar({ tipo: "http", status: 400 })).toBe(false);
    expect(debeReintentar({ tipo: "http", status: 409 })).toBe(false);
  });

  it("NO reintenta ante 401 — reintentar no renueva la sesión", () => {
    expect(debeReintentar({ tipo: "http", status: 401 })).toBe(false);
  });
});

describe("esperaAntesDeIntento", () => {
  it("crece geométricamente", () => {
    expect(esperaAntesDeIntento(1)).toBe(400);
    expect(esperaAntesDeIntento(2)).toBe(1200);
  });
});

describe("postConReintento", () => {
  it("devuelve ok al primer intento exitoso, sin reintentar", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(201, { data: { creados: 12 } }));
    const r = await postConReintento("/x", [], { fetchImpl, dormir: sinDormir });
    expect(r).toEqual({ ok: true, status: 201, json: { data: { creados: 12 } } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reintenta ante falla de red y devuelve ok si el segundo intento anda", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(respuesta(201, { data: {} }));
    const r = await postConReintento("/x", [], { fetchImpl, dormir: sinDormir });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("agota los intentos ante red caída y reporta motivo red", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const r = await postConReintento("/x", [], { fetchImpl, dormir: sinDormir });
    expect(r).toEqual({ ok: false, motivo: "red", intentos: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("NO reintenta ante 400 y devuelve el cuerpo del error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(400, { error: "Datos inválidos" }));
    const r = await postConReintento("/x", [], { fetchImpl, dormir: sinDormir });
    expect(r).toEqual({ ok: false, motivo: "http", status: 400, json: { error: "Datos inválidos" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reintenta ante 500 y se rinde con el status del último intento", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(500, { error: "boom" }));
    const r = await postConReintento("/x", [], { fetchImpl, dormir: sinDormir });
    expect(r).toEqual({ ok: false, motivo: "http", status: 500, json: { error: "boom" } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("un 200 con cuerpo no-JSON (proxy, HTML) no enmascara el éxito", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as Response);
    const r = await postConReintento("/x", [], { fetchImpl, dormir: sinDormir });
    expect(r).toEqual({ ok: true, status: 200, json: null });
  });

  it("aborta el intento colgado por timeout y lo trata como falla de red", async () => {
    // Un fetch que nunca resuelve, pero que rechaza cuando se dispara el abort.
    const fetchImpl = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
      });
    });
    const r = await postConReintento("/x", [], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      dormir: sinDormir,
      timeoutMs: 5,
      maxIntentos: 2,
    });
    expect(r).toEqual({ ok: false, motivo: "red", intentos: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("manda el clientRequestId tal como se lo pasan (no lo reescribe)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(201, {}));
    const body = [{ clientRequestId: "abc", data: {} }];
    await postConReintento("/x", body, { fetchImpl, dormir: sinDormir });
    const enviado = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(enviado[0].clientRequestId).toBe("abc");
  });

  it("el reintento manda el MISMO body (si no, no habría idempotencia)", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(respuesta(201, {}));
    const body = [{ clientRequestId: "abc", data: { mediciones: [1] } }];
    await postConReintento("/x", body, { fetchImpl, dormir: sinDormir });
    const primero = (fetchImpl.mock.calls[0][1] as RequestInit).body;
    const segundo = (fetchImpl.mock.calls[1][1] as RequestInit).body;
    expect(segundo).toBe(primero);
  });
});
