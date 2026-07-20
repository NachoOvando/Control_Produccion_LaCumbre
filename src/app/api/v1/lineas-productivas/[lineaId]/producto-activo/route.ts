/**
 * GET/POST /api/v1/lineas-productivas/:lineaId/producto-activo
 *
 * Producto/lote activo de una línea — reemplaza el <select> "Producto en
 * producción" que antes se repetía en cada formulario de captura. Activar o
 * cambiar el producto NO requiere rol de supervisión (cualquier operario
 * autenticado puede declarar qué se está fabricando ahora), a diferencia del
 * alta administrativa de lote (`/api/v1/calidad/lotes`). Queda registrado
 * quién activó cada producto en LineaActivacionLog (append-only).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { activarProductoLineaService } from "@/services/calidad/linea-producto-activo.service";
import { getProductoActivoDeLinea } from "@/db/calidad.repository";
import { jornadaProductiva } from "@/lib/calidad/fecha-planta";
import type { ProductoActivoLinea } from "@/types/calidad";

export const dynamic = "force-dynamic";

const STATUS_POR_CODE: Record<string, number> = {
  VALIDACION_ESTRUCTURA: 400,
  LINEA_NO_ENCONTRADA: 404,
  PRODUCTO_NO_ENCONTRADO: 404,
  PRODUCTO_INACTIVO: 409,
  PRODUCTO_LINEA_INCORRECTA: 409,
  PRODUCTO_SIN_VIDA_UTIL: 409,
  ACTIVACION_MUY_FRECUENTE: 429,
  LIMITE_ACTIVACIONES_EXCEDIDO: 429,
  ERROR_INTERNO: 500,
};

type Params = { params: Promise<{ lineaId: string }> };

// Aplana la forma anidada de Prisma (loteActivo.producto, activadoPor) al
// contrato plano que consumen el selector cliente y los 8 formularios.
function toProductoActivoLinea(estado: NonNullable<Awaited<ReturnType<typeof getProductoActivoDeLinea>>>): ProductoActivoLinea {
  return {
    loteId: estado.loteActivo.id,
    numeroLote: estado.loteActivo.numeroLote,
    productoId: estado.loteActivo.producto.id,
    productoNombre: estado.loteActivo.producto.nombre,
    familiaSlug: estado.loteActivo.producto.familia.slug,
    vidaUtilMeses: estado.loteActivo.producto.vidaUtilMeses,
    nomenclaturaLote: estado.loteActivo.producto.nomenclaturaLote,
    cajasPorPallet: estado.loteActivo.producto.cajasPorPallet,
    activadoPorNombre: estado.activadoPor.nombre,
    activadoEn: estado.activadoEn.toISOString(),
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado", code: "NO_AUTORIZADO" }, { status: 401 });
  }

  const { lineaId } = await params;
  // jornadaProductiva() (no hoyPlanta()): la escritura (POST, más abajo el
  // service) usa la misma ventana 6am-6am para decidir si hay que crear un
  // lote nuevo — si la lectura usara el día calendario, en la franja
  // 00:00-05:59 le diría al operario "sin producto activo" aunque sí lo hay.
  const estado = await getProductoActivoDeLinea(lineaId, jornadaProductiva());
  return NextResponse.json({ data: estado ? toProductoActivoLinea(estado) : null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado", code: "NO_AUTORIZADO" }, { status: 401 });
  }

  const { lineaId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON válido", code: "JSON_INVALIDO" }, { status: 400 });
  }

  const result = await activarProductoLineaService(lineaId, body, session.user.id);

  if (!result.ok) {
    const status = STATUS_POR_CODE[result.code] ?? 400;
    const headers = result.retryAfterSegundos ? { "Retry-After": String(result.retryAfterSegundos) } : undefined;
    return NextResponse.json({ error: result.error, code: result.code, details: result.details }, { status, headers });
  }

  return NextResponse.json({ data: toProductoActivoLinea(result.data) }, { status: 201 });
}
