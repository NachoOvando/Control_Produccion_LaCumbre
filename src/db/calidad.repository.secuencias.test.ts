import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Ver ADR-006 (docs/architecture.md) y AUDIT_PLAN.md Lote 2 (C5/C6):
// pallet_numero/nroMuestra dejan de calcularse en cliente y pasan a asignarse
// atómicamente server-side vía secuencias_diarias, dentro de la misma
// transacción que persiste el/los registros.

const txMock = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $queryRaw: vi.fn<(...args: any[]) => Promise<{ ultimo_valor: number }[]>>(),
  registroCalidad: { create: vi.fn() },
  auditoriaRegistro: { create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(txMock)),
  },
}));

import { createRegistroCalidad, createRegistrosBatchDB, esColisionRegistroUnico } from "./calidad.repository";
import type { RegistroCalidadInput } from "@/types/calidad";

const LINEA_ID = "22222222-2222-4222-8222-222222222222";
const PC_ID = "11111111-1111-4111-8111-111111111111";
const LOTE_ID = "33333333-3333-4333-8333-333333333333";
const RESP_ID = "44444444-4444-4444-8444-444444444444";

function baseInput(overrides: Partial<RegistroCalidadInput> = {}): RegistroCalidadInput {
  return {
    puntoControlId: PC_ID,
    loteId: LOTE_ID,
    lineaProductivaId: LINEA_ID,
    responsableId: RESP_ID,
    fecha: "2026-07-20",
    hora: "10:00:00",
    nroMuestra: 1,
    data: {},
    ...overrides,
  };
}

// Simula el RETURNING ultimo_valor de la secuencia: cada llamada devuelve el
// próximo valor de la lista, en orden.
function mockSecuenciaDevuelve(valores: number[]) {
  let i = 0;
  txMock.$queryRaw.mockImplementation(async () => [{ ultimo_valor: valores[i++] }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txMock.registroCalidad.create.mockImplementation(async ({ data }: any) => ({ id: data.id, ...data }));
  txMock.auditoriaRegistro.create.mockResolvedValue({ id: "aud-1" });
});

describe("createRegistrosBatchDB — asignación atómica de nroMuestra (C5)", () => {
  it("asigna un valor de secuencia distinto por cada pallet/muestra distinta del batch", async () => {
    mockSecuenciaDevuelve([1, 2]);
    const inputs = [
      baseInput({ nroMuestra: 5, data: { pallet_numero: 5, cajas: 10 } }),
      baseInput({ nroMuestra: 6, data: { pallet_numero: 6, cajas: 8 } }),
    ];

    await createRegistrosBatchDB(inputs);

    expect(txMock.$queryRaw).toHaveBeenCalledTimes(2);
    const calls = txMock.registroCalidad.create.mock.calls;
    expect(calls[0][0].data.nroMuestra).toBe(1);
    // data.pallet_numero se sincroniza con el valor server-side asignado —
    // el 5 que mandó el cliente nunca se persiste.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((calls[0][0].data.data as any).pallet_numero).toBe(1);
    expect(calls[1][0].data.nroMuestra).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((calls[1][0].data.data as any).pallet_numero).toBe(2);
  });

  it("filas que comparten nroMuestra enviado por el cliente (mismo punto de control/línea/fecha) reciben UN solo valor server-side — soporta filaProd (DefectosConformadoForm)", async () => {
    mockSecuenciaDevuelve([7]);
    const inputs = [
      baseInput({ nroMuestra: 1, filaProd: 1, data: { fistula: "Sin fístula" } }),
      baseInput({ nroMuestra: 1, filaProd: 2, data: { fistula: "Sin fístula" } }),
    ];

    await createRegistrosBatchDB(inputs);

    // Un solo incremento de secuencia, no uno por fila
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    const calls = txMock.registroCalidad.create.mock.calls;
    expect(calls[0][0].data.nroMuestra).toBe(7);
    expect(calls[1][0].data.nroMuestra).toBe(7);
    expect(calls[0][0].data.filaProd).toBe(1);
    expect(calls[1][0].data.filaProd).toBe(2);
  });

  it("un segundo batch del mismo día continúa la secuencia en vez de reiniciar en 1 (B1)", async () => {
    // Primer guardado del día: la secuencia ya venía en 0, este batch la deja en 3.
    mockSecuenciaDevuelve([3]);
    await createRegistrosBatchDB([
      baseInput({ nroMuestra: 1, filaProd: 1 }),
      baseInput({ nroMuestra: 1, filaProd: 2 }),
      baseInput({ nroMuestra: 1, filaProd: 3 }),
    ]);
    // (simulado: la fila real se movería sola con el UPDATE incremental de la DB)

    vi.clearAllMocks();
    txMock.registroCalidad.create.mockImplementation(async ({ data }: any) => ({ id: data.id, ...data }));
    txMock.auditoriaRegistro.create.mockResolvedValue({ id: "aud-2" });
    // Segundo guardado: el cliente vuelve a mandar nroMuestra=1 (arranca de cero
    // en su propio estado local) pero la secuencia persistida sigue en 3 → 4.
    mockSecuenciaDevuelve([4]);
    await createRegistrosBatchDB([
      baseInput({ nroMuestra: 1, filaProd: 1 }),
      baseInput({ nroMuestra: 1, filaProd: 2 }),
    ]);

    const calls = txMock.registroCalidad.create.mock.calls;
    expect(calls[0][0].data.nroMuestra).toBe(4);
    expect(calls[1][0].data.nroMuestra).toBe(4);
  });
});

describe("createRegistroCalidad — asignación atómica (registro individual)", () => {
  it("usa el valor devuelto por la secuencia como nroMuestra y sincroniza pallet_numero si está presente", async () => {
    mockSecuenciaDevuelve([9]);
    txMock.registroCalidad.create.mockResolvedValue({ id: "r-1" });

    await createRegistroCalidad(baseInput({ data: { pallet_numero: 1 } }));

    const call = txMock.registroCalidad.create.mock.calls[0][0];
    expect(call.data.nroMuestra).toBe(9);
    expect(call.data.data.pallet_numero).toBe(9);
  });
});

describe("esColisionRegistroUnico — C6", () => {
  function p2002(target: unknown) {
    const e = new Prisma.PrismaClientKnownRequestError("colisión", { code: "P2002", clientVersion: "x" });
    e.meta = { target };
    return e;
  }

  it("detecta colisión cuando meta.target es el array de columnas de registro_unico", () => {
    expect(esColisionRegistroUnico(p2002(["punto_control_id", "lote_id", "fecha", "nro_muestra", "fila_prod"]))).toBe(true);
  });

  it("detecta colisión cuando meta.target es el nombre de la constraint", () => {
    expect(esColisionRegistroUnico(p2002("registro_unico"))).toBe(true);
  });

  it("no confunde con una colisión de otra constraint (ej. numero_lote)", () => {
    expect(esColisionRegistroUnico(p2002(["numero_lote"]))).toBe(false);
  });

  it("no confunde un error genérico con una colisión", () => {
    expect(esColisionRegistroUnico(new Error("boom"))).toBe(false);
  });
});
