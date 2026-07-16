import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    producto: { findUnique: vi.fn() },
  },
}));
vi.mock("@/db/calidad.repository", () => ({
  crearLote: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { crearLote } from "@/db/calidad.repository";
import { crearLoteService } from "./lote.service";

const findUniqueMock = vi.mocked(prisma.producto.findUnique);
const crearLoteMock = vi.mocked(crearLote);

const INPUT_VALIDO = {
  productoId: "11111111-1111-4111-8111-111111111111",
  fechaProduccion: "2026-07-15",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("crearLoteService", () => {
  it("rechaza payload inválido con VALIDACION_ESTRUCTURA", async () => {
    const res = await crearLoteService({ productoId: "no-es-uuid", fechaProduccion: "15/07/2026" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDACION_ESTRUCTURA");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("rechaza producto inexistente con PRODUCTO_NO_ENCONTRADO", async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await crearLoteService(INPUT_VALIDO);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PRODUCTO_NO_ENCONTRADO");
  });

  it("rechaza producto inactivo con PRODUCTO_INACTIVO", async () => {
    findUniqueMock.mockResolvedValue({ id: INPUT_VALIDO.productoId, activo: false, nombre: "X" } as never);
    const res = await crearLoteService(INPUT_VALIDO);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PRODUCTO_INACTIVO");
    expect(crearLoteMock).not.toHaveBeenCalled();
  });

  it("camino feliz: delega a crearLote con el creadoPorId de la sesión", async () => {
    findUniqueMock.mockResolvedValue({ id: INPUT_VALIDO.productoId, activo: true, nombre: "X" } as never);
    crearLoteMock.mockResolvedValue({ id: "lote-1", numeroLote: "GEN-X" } as never);

    const res = await crearLoteService(INPUT_VALIDO, "user-1");
    expect(res.ok).toBe(true);
    expect(crearLoteMock).toHaveBeenCalledWith(
      INPUT_VALIDO.productoId,
      new Date("2026-07-15"),
      undefined,
      "user-1"
    );
  });

  it("un throw del repository se traduce a ERROR_INTERNO, no explota", async () => {
    findUniqueMock.mockResolvedValue({ id: INPUT_VALIDO.productoId, activo: true, nombre: "X" } as never);
    crearLoteMock.mockRejectedValue(new Error("boom"));
    const res = await crearLoteService(INPUT_VALIDO);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ERROR_INTERNO");
  });
});
