import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    producto: { findUnique: vi.fn() },
    puntoControlParametro: { findUnique: vi.fn() },
  },
}));
vi.mock("@/db/maestro.repository", () => ({
  crearProducto: vi.fn(),
  actualizarProducto: vi.fn(),
  crearMarca: vi.fn(),
  actualizarMarca: vi.fn(),
  crearFamilia: vi.fn(),
  actualizarFamilia: vi.fn(),
  versionarEspecificacion: vi.fn(),
  esColisionEspecVigente: vi.fn(() => false),
}));

import { prisma } from "@/lib/prisma";
import { versionarEspecificacion } from "@/db/maestro.repository";
import {
  guardarEspecificacionService,
  crearFamiliaService,
} from "./maestro.service";

const productoFind = vi.mocked(prisma.producto.findUnique);
const bindingFind = vi.mocked(prisma.puntoControlParametro.findUnique);
const versionarMock = vi.mocked(versionarEspecificacion);

const IDS = {
  producto: "11111111-1111-4111-8111-111111111111",
  punto: "22222222-2222-4222-8222-222222222222",
  parametro: "33333333-3333-4333-8333-333333333333",
  usuario: "44444444-4444-4444-8444-444444444444",
};

function specValida(overrides: Record<string, unknown> = {}) {
  return {
    productoId: IDS.producto,
    puntoControlId: IDS.punto,
    parametroId: IDS.parametro,
    objetivo: 75,
    aceptacionMin: 72,
    aceptacionMax: 78,
    criticoMin: 68,
    criticoMax: 82,
    esCritico: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  productoFind.mockResolvedValue({ id: IDS.producto } as never);
  bindingFind.mockResolvedValue({ agregacion: "array_cada" } as never);
  versionarMock.mockResolvedValue({ id: "spec-1" } as never);
});

describe("guardarEspecificacionService — validación de ordenamiento", () => {
  it("acepta una spec bien anidada (crítico ⊇ aceptación ∋ objetivo)", async () => {
    const res = await guardarEspecificacionService(specValida(), IDS.usuario);
    expect(res.ok).toBe(true);
    expect(versionarMock).toHaveBeenCalledOnce();
  });

  it("rechaza aceptacionMin > aceptacionMax", async () => {
    const res = await guardarEspecificacionService(specValida({ aceptacionMin: 80, aceptacionMax: 70 }), IDS.usuario);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDACION_ESTRUCTURA");
    expect(versionarMock).not.toHaveBeenCalled();
  });

  it("rechaza objetivo fuera del rango de aceptación", async () => {
    const res = await guardarEspecificacionService(specValida({ objetivo: 90 }), IDS.usuario);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDACION_ESTRUCTURA");
  });

  it("rechaza aceptación que se sale del crítico", async () => {
    const res = await guardarEspecificacionService(specValida({ aceptacionMax: 90 }), IDS.usuario);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDACION_ESTRUCTURA");
  });

  it("rechaza una spec sin ningún límite ni objetivo", async () => {
    const res = await guardarEspecificacionService(
      { productoId: IDS.producto, puntoControlId: IDS.punto, parametroId: IDS.parametro, esCritico: false },
      IDS.usuario
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDACION_ESTRUCTURA");
  });

  it("acepta límites asimétricos (solo max, sin min)", async () => {
    const res = await guardarEspecificacionService(
      { productoId: IDS.producto, puntoControlId: IDS.punto, parametroId: IDS.parametro, aceptacionMax: 78, esCritico: false },
      IDS.usuario
    );
    expect(res.ok).toBe(true);
  });

  it("rechaza si el binding (punto de control × parámetro) no existe", async () => {
    bindingFind.mockResolvedValue(null);
    const res = await guardarEspecificacionService(specValida(), IDS.usuario);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("BINDING_INEXISTENTE");
    expect(versionarMock).not.toHaveBeenCalled();
  });

  it("rechaza producto inexistente", async () => {
    productoFind.mockResolvedValue(null);
    const res = await guardarEspecificacionService(specValida(), IDS.usuario);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PRODUCTO_NO_ENCONTRADO");
  });
});

describe("crearFamiliaService — validación de slug", () => {
  it("rechaza slug con mayúsculas o espacios", async () => {
    const res = await crearFamiliaService({ slug: "Alfajor Negro", nombre: "Alfajor Negro" }, IDS.usuario);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDACION_ESTRUCTURA");
  });

  it("acepta slug válido", async () => {
    const { crearFamilia } = await import("@/db/maestro.repository");
    vi.mocked(crearFamilia).mockResolvedValue({ id: "fam-1" } as never);
    const res = await crearFamiliaService({ slug: "alfajor_negro", nombre: "Alfajor Negro" }, IDS.usuario);
    expect(res.ok).toBe(true);
  });
});
