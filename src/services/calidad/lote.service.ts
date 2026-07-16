/**
 * Service layer — Alta de Lote
 *
 * Valida el payload y que el producto exista/esté activo antes de delegar
 * la escritura al repository. Sin lógica de negocio en el router.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { crearLote } from "@/db/calidad.repository";

const CrearLoteInputSchema = z.object({
  productoId: z.string().uuid("productoId debe ser UUID"),
  fechaProduccion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fechaProduccion debe tener formato YYYY-MM-DD"),
  notas: z.string().max(1000).optional(),
});

export type CrearLoteResult =
  | { ok: true; data: Awaited<ReturnType<typeof crearLote>> }
  | { ok: false; error: string; code: string; details?: unknown };

export async function crearLoteService(rawInput: unknown, creadoPorId?: string): Promise<CrearLoteResult> {
  const parsed = CrearLoteInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos de alta de lote inválidos",
      code: "VALIDACION_ESTRUCTURA",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const { productoId, fechaProduccion, notas } = parsed.data;

  const producto = await prisma.producto.findUnique({
    where: { id: productoId },
    select: { id: true, activo: true, nombre: true },
  });

  if (!producto) return { ok: false, error: "Producto no encontrado", code: "PRODUCTO_NO_ENCONTRADO" };
  if (!producto.activo) return { ok: false, error: `El producto '${producto.nombre}' está inactivo`, code: "PRODUCTO_INACTIVO" };

  try {
    const lote = await crearLote(productoId, new Date(fechaProduccion), notas, creadoPorId);
    return { ok: true, data: lote };
  } catch (err) {
    console.error("[lote.service] Error al crear lote:", err);
    return { ok: false, error: "Error interno al crear el lote", code: "ERROR_INTERNO" };
  }
}
