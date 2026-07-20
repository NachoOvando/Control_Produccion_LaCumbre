import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lote: { create: vi.fn() },
  },
}));
vi.mock("@/lib/calidad/fecha-planta", () => ({
  horaPlanta: vi.fn(() => "14:32"),
}));

import { prisma } from "@/lib/prisma";
import { horaPlanta } from "@/lib/calidad/fecha-planta";
import { crearLote } from "./calidad.repository";

const createMock = vi.mocked(prisma.lote.create);
const horaPlantaMock = vi.mocked(horaPlanta);

beforeEach(() => {
  vi.clearAllMocks();
  horaPlantaMock.mockReturnValue("14:32");
});

describe("crearLote — reconstrucción de fecha UTC→local (regresión)", () => {
  // fechaProduccion llega parseada de un string ISO ("yyyy-MM-dd" vía
  // jornadaProductiva()) — eso la construye en UTC medianoche. Si el proceso
  // Node corre con timezone detrás de UTC, los getters LOCALES que usa
  // generarNumeroLote (vencimiento, día juliano) leerían el día anterior sin
  // la reconstrucción que hace crearLote antes de generar el numeroLote — este
  // test fija el bug encontrado en browser (vencimiento "19/11" con día
  // juliano "6201", que corresponde al 20) y no depende de la TZ de quien corre
  // el test: comparamos contra el string ISO que se pasó, no contra "hoy".
  it("usa el mismo día calendario que el string ISO de entrada, formato nuevo (con línea)", async () => {
    createMock.mockResolvedValue({ id: "lote-1", numeroLote: "x" } as never);

    // 2026-07-20T00:00:00.000Z — exactamente lo que devuelve
    // `new Date(jornadaProductiva())` para la jornada "2026-07-20".
    const fechaProduccion = new Date("2026-07-20T00:00:00.000Z");

    await crearLote({
      productoId: "producto-1",
      fechaProduccion,
      vidaUtilMeses: 4,
      lineaCodigo: 3,
    });

    const numeroLote = createMock.mock.calls[0][0].data.numeroLote as string;
    // Vencimiento 20/07 + 4 meses = 20/11; día juliano de 20/07/2026 = 201.
    expect(numeroLote).toBe("L-20/11/2026-6201-14:32-3");
  });

  it("usa el mismo día calendario que el string ISO de entrada, formato legacy (sin línea)", async () => {
    createMock.mockResolvedValue({ id: "lote-1", numeroLote: "x" } as never);

    // Solo fijamos la FECHA de producción (día); la hora del placeholder GEN-
    // es la de creación del registro en la TZ de la máquina que corre el
    // proceso — no depende de fechaProduccion, así que no la fijamos ni la
    // comparamos acá (eso NO es el bug que este archivo cubre).
    const fechaProduccion = new Date("2026-07-20T00:00:00.000Z");
    await crearLote({ productoId: "producto-1", fechaProduccion });

    const numeroLote = createMock.mock.calls[0][0].data.numeroLote as string;
    expect(numeroLote).toMatch(/^GEN-20260720-\d{6}$/);
  });

  it("agrega sufijo de desambiguación en el reintento, en ambos formatos", async () => {
    const colision = new Prisma.PrismaClientKnownRequestError("colisión", { code: "P2002", clientVersion: "x" });
    colision.meta = { target: ["numero_lote"] };
    createMock.mockRejectedValueOnce(colision).mockResolvedValueOnce({ id: "lote-1", numeroLote: "x" } as never);

    const fechaProduccion = new Date("2026-07-20T00:00:00.000Z");
    await crearLote({ productoId: "producto-1", fechaProduccion, vidaUtilMeses: 4, lineaCodigo: 3 });

    expect(createMock).toHaveBeenCalledTimes(2);
    const primerIntento = createMock.mock.calls[0][0].data.numeroLote as string;
    const segundoIntento = createMock.mock.calls[1][0].data.numeroLote as string;
    expect(primerIntento).toBe("L-20/11/2026-6201-14:32-3");
    expect(segundoIntento).toBe("L-20/11/2026-6201-14:32-3-02");
  });
});
