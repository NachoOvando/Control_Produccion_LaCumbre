/**
 * Service layer — Producto activo de línea
 *
 * Activa/cambia qué se está produciendo en una línea (find-or-create de Lote +
 * puntero LineaProduccionEstado + log de activación). A diferencia del alta de
 * lote administrativa, no requiere rol de supervisión: cualquier operario con
 * sesión puede declarar qué se está fabricando ahora, y queda registrado quién.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { activarProductoLinea } from "@/db/calidad.repository";
import { jornadaProductiva } from "@/lib/calidad/fecha-planta";

const ActivarProductoInputSchema = z.object({
  productoId: z.string().uuid("productoId debe ser UUID"),
});

export type ActivarProductoResult =
  | { ok: true; data: Awaited<ReturnType<typeof activarProductoLinea>> }
  | { ok: false; error: string; code: string; details?: unknown; retryAfterSegundos?: number };

// Guard anti-abuso — decisión de arquitecto-industrial: activar producto mueve
// un puntero de estado (LineaProduccionEstado) del que dependen en tiempo real
// los 8 formularios de captura y la generación de lotes; no es rate limiting
// genérico, es integridad de trazabilidad (auditorías Arcor). Se apoya en
// LineaActivacionLog (append-only, ya existente) — sin caché ni estado en
// memoria de proceso, para no romper el patrón stateless del resto del repo.
const COOLDOWN_SEGUNDOS = 30;
const VENTANA_MINUTOS = 10;
const MAX_ACTIVACIONES_EN_VENTANA = 5;

async function verificarLimiteActivaciones(
  lineaProductivaId: string,
  usuarioId: string
): Promise<ActivarProductoResult | null> {
  const desdeVentana = new Date(Date.now() - VENTANA_MINUTOS * 60_000);
  // Defensa adicional (Lote 4, P3): el guard normal ya corta en
  // MAX_ACTIVACIONES_EN_VENTANA=5, este take es solo un tope duro de filas
  // ante un bug futuro que rompa ese guard (p.ej. VENTANA_MINUTOS mal
  // configurado o un usuario/línea con un volumen anómalo) — el margen
  // sobre el máximo real (5) es amplio a propósito para no alterar el
  // comportamiento normal, solo evitar un findMany sin límite.
  const TAKE_DEFENSA = 50;
  const recientes = await prisma.lineaActivacionLog.findMany({
    where: { lineaProductivaId, usuarioId, createdAt: { gte: desdeVentana } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
    take: TAKE_DEFENSA,
  });

  if (recientes.length === 0) return null;

  const segundosDesdeUltima = (Date.now() - recientes[0].createdAt.getTime()) / 1000;
  if (segundosDesdeUltima < COOLDOWN_SEGUNDOS) {
    const retryAfterSegundos = Math.ceil(COOLDOWN_SEGUNDOS - segundosDesdeUltima);
    return {
      ok: false,
      error: "Activaste un producto hace muy poco en esta línea — esperá un momento antes de cambiarlo de nuevo",
      code: "ACTIVACION_MUY_FRECUENTE",
      retryAfterSegundos,
    };
  }

  if (recientes.length >= MAX_ACTIVACIONES_EN_VENTANA) {
    return {
      ok: false,
      error: `Se alcanzó el máximo de ${MAX_ACTIVACIONES_EN_VENTANA} cambios de producto en ${VENTANA_MINUTOS} minutos para esta línea`,
      code: "LIMITE_ACTIVACIONES_EXCEDIDO",
      retryAfterSegundos: VENTANA_MINUTOS * 60,
    };
  }

  return null;
}

export async function activarProductoLineaService(
  lineaProductivaId: string,
  rawInput: unknown,
  usuarioId: string
): Promise<ActivarProductoResult> {
  const parsed = ActivarProductoInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos de activación de producto inválidos",
      code: "VALIDACION_ESTRUCTURA",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const linea = await prisma.lineaProductiva.findUnique({
    where: { id: lineaProductivaId },
    select: { id: true, codigo: true },
  });
  if (!linea) return { ok: false, error: "Línea productiva no encontrada", code: "LINEA_NO_ENCONTRADA" };

  const limite = await verificarLimiteActivaciones(lineaProductivaId, usuarioId);
  if (limite) return limite;

  const { productoId } = parsed.data;
  const producto = await prisma.producto.findUnique({
    where: { id: productoId },
    select: { id: true, activo: true, nombre: true, lineaProductivaId: true, vidaUtilMeses: true },
  });
  if (!producto) return { ok: false, error: "Producto no encontrado", code: "PRODUCTO_NO_ENCONTRADO" };
  if (!producto.activo) return { ok: false, error: `El producto '${producto.nombre}' está inactivo`, code: "PRODUCTO_INACTIVO" };
  // El selector de UI ya filtra por línea, pero un POST directo podía cruzar
  // líneas. Productos sin línea asignada en el maestro (34/104) se activan en
  // cualquier línea — mismo criterio que el filtro de UI.
  if (producto.lineaProductivaId !== null && producto.lineaProductivaId !== lineaProductivaId) {
    return {
      ok: false,
      error: "El producto pertenece a otra línea productiva",
      code: "PRODUCTO_LINEA_INCORRECTA",
    };
  }
  // El numeroLote definitivo (2026-07-16) necesita la vida útil del producto
  // para el segmento de vencimiento — decisión explícita del usuario: bloquear
  // en vez de generar un placeholder, para forzar a completar el maestro.
  // Se valida > 0 (no solo no-null) para no delegar en el throw defensivo de
  // calcularFechaVencimiento — un dato mal cargado en el maestro (0 o negativo)
  // debe dar el mismo 409 claro, no un 500 genérico (hallazgo seguridad-analista).
  if (producto.vidaUtilMeses == null || producto.vidaUtilMeses <= 0) {
    return {
      ok: false,
      error: `El producto '${producto.nombre}' no tiene vida útil cargada en el maestro — completá ese dato antes de activarlo`,
      code: "PRODUCTO_SIN_VIDA_UTIL",
    };
  }

  try {
    const estado = await activarProductoLinea({
      lineaProductivaId,
      productoId,
      usuarioId,
      fechaProduccion: new Date(jornadaProductiva()),
      vidaUtilMeses: producto.vidaUtilMeses,
      lineaCodigo: linea.codigo,
    });
    return { ok: true, data: estado };
  } catch (err) {
    console.error("[linea-producto-activo.service] Error al activar producto:", err);
    return { ok: false, error: "Error interno al activar el producto", code: "ERROR_INTERNO" };
  }
}
