import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { validarTokenSesion } from "./session-validation";
import type { JWT } from "next-auth/jwt";

const findUniqueMock = vi.mocked(prisma.usuario.findUnique);

const AHORA = 1_800_000_000_000;
const TOKEN_BASE: JWT = {
  id: "11111111-1111-4111-8111-111111111111",
  rol: "operario",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validarTokenSesion", () => {
  it("usuario existente y activo → token con rol refrescado y validadoEn actualizado", async () => {
    findUniqueMock.mockResolvedValue({ activo: true, rol: "supervisor_calidad" } as never);
    const res = await validarTokenSesion({ ...TOKEN_BASE }, AHORA);
    expect(res).not.toBeNull();
    expect(res?.rol).toBe("supervisor_calidad");
    expect(res?.validadoEn).toBe(AHORA);
  });

  it("usuario inexistente → null (mata la sesión — caso del usuario fantasma)", async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await validarTokenSesion(
      { ...TOKEN_BASE, id: "00000000-0000-0000-0000-000000000001" },
      AHORA
    );
    expect(res).toBeNull();
  });

  it("usuario desactivado → null (una desactivación real corta la sesión viva)", async () => {
    findUniqueMock.mockResolvedValue({ activo: false, rol: "operario" } as never);
    const res = await validarTokenSesion({ ...TOKEN_BASE }, AHORA);
    expect(res).toBeNull();
  });

  it("error de DB → token intacto (fail-open: un blip de red no desloguea a la planta)", async () => {
    findUniqueMock.mockRejectedValue(new Error("Can't reach database server"));
    const token = { ...TOKEN_BASE, validadoEn: AHORA - 120_000 };
    const res = await validarTokenSesion(token, AHORA);
    expect(res).toBe(token);
  });

  it("dentro de la ventana de 60s → no consulta la DB", async () => {
    const token = { ...TOKEN_BASE, validadoEn: AHORA - 59_000 };
    const res = await validarTokenSesion(token, AHORA);
    expect(res).toBe(token);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("fuera de la ventana de 60s → vuelve a consultar la DB", async () => {
    findUniqueMock.mockResolvedValue({ activo: true, rol: "operario" } as never);
    const res = await validarTokenSesion({ ...TOKEN_BASE, validadoEn: AHORA - 61_000 }, AHORA);
    expect(findUniqueMock).toHaveBeenCalledOnce();
    expect(res?.validadoEn).toBe(AHORA);
  });

  it("token con id malformado → null sin tocar la DB (evita P2023 + fail-open)", async () => {
    const res = await validarTokenSesion({ ...TOKEN_BASE, id: "no-es-un-uuid" }, AHORA);
    expect(res).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
