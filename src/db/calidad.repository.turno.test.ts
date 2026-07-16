import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    turno: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getTurnoByHora } from "./calidad.repository";

const turnosMock = vi.mocked(prisma.turno.findMany);

const TURNOS = [
  { id: "t-manana", horaInicio: "06:00", horaFin: "14:00", activo: true },
  { id: "t-tarde", horaInicio: "14:00", horaFin: "22:00", activo: true },
  { id: "t-noche", horaInicio: "22:00", horaFin: "06:00", activo: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  turnosMock.mockResolvedValue(TURNOS as never);
});

describe("getTurnoByHora", () => {
  it("resuelve un turno de rango normal", async () => {
    expect(await getTurnoByHora("08:30")).toBe("t-manana");
    expect(await getTurnoByHora("15:00")).toBe("t-tarde");
  });

  it("el límite inferior es inclusivo y el superior exclusivo", async () => {
    expect(await getTurnoByHora("06:00")).toBe("t-manana");
    expect(await getTurnoByHora("14:00")).toBe("t-tarde");
  });

  it("resuelve el turno noche que cruza medianoche (antes y después de 00:00)", async () => {
    expect(await getTurnoByHora("23:30")).toBe("t-noche");
    expect(await getTurnoByHora("02:00")).toBe("t-noche");
    expect(await getTurnoByHora("05:59")).toBe("t-noche");
  });

  it("acepta formato HH:MM:SS", async () => {
    expect(await getTurnoByHora("08:30:45")).toBe("t-manana");
  });

  it("devuelve null sin turnos configurados", async () => {
    turnosMock.mockResolvedValue([] as never);
    expect(await getTurnoByHora("08:30")).toBeNull();
  });

  it("devuelve null (no explota) si la DB falla", async () => {
    turnosMock.mockRejectedValue(new Error("db caída"));
    expect(await getTurnoByHora("08:30")).toBeNull();
  });
});
