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
