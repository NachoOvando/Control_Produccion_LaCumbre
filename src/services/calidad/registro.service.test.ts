import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// C6 (AUDIT_PLAN.md Lote 2): un conflicto de la constraint registro_unico ya
// no se mapea al mismo ERROR_INTERNO genérico que un bug real.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    puntoControl: { findUnique: vi.fn(), findMany: vi.fn() },
    lote: { findUnique: vi.fn() },
    lineaProductiva: { findUnique: vi.fn() },
  },
}));
vi.mock("@/db/calidad.repository", () => ({
  createRegistroCalidad: vi.fn(),
  createRegistrosBatchDB: vi.fn(),
  getTurnoByHora: vi.fn(async () => null),
  esColisionRegistroUnico: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  createRegistroCalidad,
  createRegistrosBatchDB,
  esColisionRegistroUnico,
} from "@/db/calidad.repository";
import { createRegistroService, createRegistrosBatchService } from "./registro.service";
import { schemaRoturaEncajado } from "@/lib/calidad/schemas/rotura-encajado.schema";

const puntoControlMock = vi.mocked(prisma.puntoControl.findUnique);
const puntoControlFindManyMock = vi.mocked(prisma.puntoControl.findMany);
const loteMock = vi.mocked(prisma.lote.findUnique);
const lineaMock = vi.mocked(prisma.lineaProductiva.findUnique);
const createRegistroMock = vi.mocked(createRegistroCalidad);
const createBatchMock = vi.mocked(createRegistrosBatchDB);
const esColisionMock = vi.mocked(esColisionRegistroUnico);

const PC_ID = "11111111-1111-4111-8111-111111111111";
const LOTE_ID = "22222222-2222-4222-8222-222222222222";
const LINEA_ID = "33333333-3333-4333-8333-333333333333";
const RESP_ID = "44444444-4444-4444-8444-444444444444";

function inputValido(overrides: Record<string, unknown> = {}) {
  return {
    puntoControlId: PC_ID,
    loteId: LOTE_ID,
    lineaProductivaId: LINEA_ID,
    responsableId: RESP_ID,
    fecha: "2026-07-20",
    hora: "10:00",
    nroMuestra: 1,
    data: {},
    ...overrides,
  };
}

function p2002(): unknown {
  const e = new Prisma.PrismaClientKnownRequestError("colisión", { code: "P2002", clientVersion: "x" });
  e.meta = { target: "registro_unico" };
  return e;
}

beforeEach(() => {
  vi.clearAllMocks();
  puntoControlMock.mockResolvedValue({ schemaJson: {}, activo: true, nombre: "PC" } as never);
  puntoControlFindManyMock.mockResolvedValue([{ id: PC_ID, schemaJson: {}, nombre: "PC", activo: true }] as never);
  loteMock.mockResolvedValue({ id: LOTE_ID } as never);
  lineaMock.mockResolvedValue({ id: LINEA_ID } as never);
});

describe("createRegistroService — mapeo de errores de persistencia (C6)", () => {
  it("mapea una colisión de registro_unico a CONFLICTO_CORRELATIVO en vez de ERROR_INTERNO", async () => {
    esColisionMock.mockReturnValue(true);
    createRegistroMock.mockRejectedValue(p2002());

    const res = await createRegistroService(inputValido());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICTO_CORRELATIVO");
  });

  it("un error real de persistencia sigue siendo ERROR_INTERNO", async () => {
    esColisionMock.mockReturnValue(false);
    createRegistroMock.mockRejectedValue(new Error("DB caída"));

    const res = await createRegistroService(inputValido());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ERROR_INTERNO");
  });

  it("camino feliz sigue funcionando", async () => {
    esColisionMock.mockReturnValue(false);
    createRegistroMock.mockResolvedValue({ id: "r-1" } as never);

    const res = await createRegistroService(inputValido());

    expect(res.ok).toBe(true);
  });
});

describe("createRegistrosBatchService — mapeo de errores de persistencia (C6)", () => {
  it("mapea una colisión de registro_unico a CONFLICTO_CORRELATIVO en el batch", async () => {
    esColisionMock.mockReturnValue(true);
    createBatchMock.mockRejectedValue(p2002());

    const res = await createRegistrosBatchService([inputValido()], RESP_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICTO_CORRELATIVO");
  });

  it("un error real de persistencia en el batch sigue siendo ERROR_INTERNO", async () => {
    esColisionMock.mockReturnValue(false);
    createBatchMock.mockRejectedValue(new Error("DB caída"));

    const res = await createRegistrosBatchService([inputValido()], RESP_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ERROR_INTERNO");
  });
});

// Gate de rollout (2026-08-06): la app sale a producción con 8 de los 12 puntos
// de control habilitados, y el resto se habilita moviendo `puntos_control.activo`
// a mano. Que el rechazo del server sea correcto y distinguible es parte del
// feature, no un detalle: el gate se mueve con operarios cargando.
describe("puntos de control deshabilitados (gate de rollout)", () => {
  beforeEach(() => {
    esColisionMock.mockReturnValue(false);
  });

  it("rechaza el alta individual con PUNTO_CONTROL_INACTIVO", async () => {
    puntoControlMock.mockResolvedValue({ schemaJson: {}, activo: false, nombre: "Control Peso Relleno" } as never);

    const res = await createRegistroService(inputValido());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PUNTO_CONTROL_INACTIVO");
    expect(createRegistroMock).not.toHaveBeenCalled();
  });

  it("rechaza el batch con PUNTO_CONTROL_INACTIVO, no con VALIDACION_DATOS", async () => {
    // El operario tiene que leer "no está habilitado", no "N registro(s) con
    // datos inválidos" — que es lo que salía cuando el inactivo caía junto a
    // los errores de JSON Schema.
    puntoControlFindManyMock.mockResolvedValue([
      { id: PC_ID, schemaJson: {}, nombre: "Control Peso Relleno", activo: false },
    ] as never);

    const res = await createRegistrosBatchService([inputValido(), inputValido()], RESP_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PUNTO_CONTROL_INACTIVO");
      expect(res.error).toContain("Control Peso Relleno");
      expect(res.error).toContain("no está habilitado");
    }
    expect(createBatchMock).not.toHaveBeenCalled();
  });

  it("un punto de control habilitado sigue guardando normalmente", async () => {
    createBatchMock.mockResolvedValue([{ id: "r-1" }] as never);

    const res = await createRegistrosBatchService([inputValido()], RESP_ID);

    expect(res.ok).toBe(true);
    expect(createBatchMock).toHaveBeenCalled();
  });
});

// Control de Rotura en Encajado: valida el payload real del formulario contra el
// schema real sembrado, pasando por las DOS capas (Zod estructural + AJV sobre
// schemaJson). schemas.test.ts cubre AJV en aislamiento; esto cubre que filaProd
// sobreviva a Zod y que las 2 máquinas de una hora lleguen juntas al repository.
describe("createRegistrosBatchService — rotura en encajado (filaProd)", () => {
  const dataRotura = (maquina: number) => ({
    maquina,
    unidades_muestreadas: 21,
    golpeado_rotura_menor: 1,
    golpeado_rotura_mayor: 0,
    aplastado_rotura_leve: 0,
    aplastado_rotura_intermedia: 0,
    aplastado_rotura_mayor: 0,
  });

  beforeEach(() => {
    puntoControlFindManyMock.mockResolvedValue([
      { id: PC_ID, schemaJson: schemaRoturaEncajado, nombre: "Control de Rotura en Encajado", activo: true },
    ] as never);
    esColisionMock.mockReturnValue(false);
    createBatchMock.mockResolvedValue([{ id: "r-1" }, { id: "r-2" }] as never);
  });

  it("acepta las 2 máquinas de una hora con el mismo nroMuestra y filaProd 1 y 2", async () => {
    const res = await createRegistrosBatchService(
      [
        inputValido({ nroMuestra: 1, filaProd: 1, data: dataRotura(1) }),
        inputValido({ nroMuestra: 1, filaProd: 2, data: dataRotura(2) }),
      ],
      RESP_ID
    );

    expect(res.ok).toBe(true);
    // filaProd tiene que sobrevivir a Zod y llegar al repository: es lo que
    // distingue las 2 máquinas dentro del mismo correlativo.
    const enviados = createBatchMock.mock.calls[0][0];
    expect(enviados).toHaveLength(2);
    expect(enviados[0].filaProd).toBe(1);
    expect(enviados[1].filaProd).toBe(2);
    expect(enviados[0].nroMuestra).toBe(enviados[1].nroMuestra);
  });

  it("rechaza el batch si el payload no cumple el schema del punto de control", async () => {
    const res = await createRegistrosBatchService(
      [inputValido({ nroMuestra: 1, filaProd: 1, data: { maquina: 1 } })],
      RESP_ID
    );

    expect(res.ok).toBe(false);
    expect(createBatchMock).not.toHaveBeenCalled();
  });
});
