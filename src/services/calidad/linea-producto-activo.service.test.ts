import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lineaProductiva: { findUnique: vi.fn() },
    producto: { findUnique: vi.fn() },
    lineaActivacionLog: { findMany: vi.fn() },
  },
}));
vi.mock("@/db/calidad.repository", () => ({
  activarProductoLinea: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { activarProductoLinea } from "@/db/calidad.repository";
import { activarProductoLineaService } from "./linea-producto-activo.service";

const lineaMock = vi.mocked(prisma.lineaProductiva.findUnique);
const productoMock = vi.mocked(prisma.producto.findUnique);
const logMock = vi.mocked(prisma.lineaActivacionLog.findMany);
const activarMock = vi.mocked(activarProductoLinea);

const LINEA_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCTO_ID = "11111111-1111-4111-8111-111111111111";
const USUARIO_ID = "33333333-3333-4333-8333-333333333333";

function setupCaminoFeliz() {
  lineaMock.mockResolvedValue({ id: LINEA_ID } as never);
  logMock.mockResolvedValue([] as never);
  productoMock.mockResolvedValue({
    id: PRODUCTO_ID,
    activo: true,
    nombre: "ALFAJOR NEGRO",
    lineaProductivaId: LINEA_ID,
  } as never);
  activarMock.mockResolvedValue({ loteActivoId: "lote-1" } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("activarProductoLineaService — validaciones", () => {
  it("rechaza body sin productoId UUID con VALIDACION_ESTRUCTURA", async () => {
    const res = await activarProductoLineaService(LINEA_ID, { productoId: "nope" }, USUARIO_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDACION_ESTRUCTURA");
  });

  it("rechaza línea inexistente con LINEA_NO_ENCONTRADA", async () => {
    lineaMock.mockResolvedValue(null);
    const res = await activarProductoLineaService(LINEA_ID, { productoId: PRODUCTO_ID }, USUARIO_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("LINEA_NO_ENCONTRADA");
  });

  it("rechaza producto de OTRA línea con PRODUCTO_LINEA_INCORRECTA (409)", async () => {
    setupCaminoFeliz();
    productoMock.mockResolvedValue({
      id: PRODUCTO_ID,
      activo: true,
      nombre: "BUDIN",
      lineaProductivaId: "99999999-9999-4999-8999-999999999999",
    } as never);

    const res = await activarProductoLineaService(LINEA_ID, { productoId: PRODUCTO_ID }, USUARIO_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PRODUCTO_LINEA_INCORRECTA");
    expect(activarMock).not.toHaveBeenCalled();
  });

  it("acepta producto SIN línea asignada en el maestro (null se activa en cualquiera)", async () => {
    setupCaminoFeliz();
    productoMock.mockResolvedValue({
      id: PRODUCTO_ID,
      activo: true,
      nombre: "SNACK",
      lineaProductivaId: null,
    } as never);

    const res = await activarProductoLineaService(LINEA_ID, { productoId: PRODUCTO_ID }, USUARIO_ID);
    expect(res.ok).toBe(true);
  });
});

describe("activarProductoLineaService — guard anti-abuso", () => {
  it("bloquea con ACTIVACION_MUY_FRECUENTE si hubo una activación hace <30s", async () => {
    setupCaminoFeliz();
    logMock.mockResolvedValue([{ createdAt: new Date(Date.now() - 10_000) }] as never);

    const res = await activarProductoLineaService(LINEA_ID, { productoId: PRODUCTO_ID }, USUARIO_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("ACTIVACION_MUY_FRECUENTE");
      expect(res.retryAfterSegundos).toBeGreaterThan(0);
    }
    expect(activarMock).not.toHaveBeenCalled();
  });

  it("bloquea con LIMITE_ACTIVACIONES_EXCEDIDO con 5 activaciones en la ventana de 10min", async () => {
    setupCaminoFeliz();
    // 5 activaciones dentro de la ventana, la más reciente hace 60s (pasa el cooldown de 30s)
    logMock.mockResolvedValue(
      [60, 120, 180, 240, 300].map((s) => ({ createdAt: new Date(Date.now() - s * 1000) })) as never
    );

    const res = await activarProductoLineaService(LINEA_ID, { productoId: PRODUCTO_ID }, USUARIO_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("LIMITE_ACTIVACIONES_EXCEDIDO");
  });

  it("permite activar con actividad vieja fuera del cooldown y bajo el límite", async () => {
    setupCaminoFeliz();
    logMock.mockResolvedValue([{ createdAt: new Date(Date.now() - 120_000) }] as never);

    const res = await activarProductoLineaService(LINEA_ID, { productoId: PRODUCTO_ID }, USUARIO_ID);
    expect(res.ok).toBe(true);
    expect(activarMock).toHaveBeenCalledOnce();
  });
});
