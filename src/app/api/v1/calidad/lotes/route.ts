/**
 * POST /api/v1/calidad/lotes — alta de un lote de producción
 *
 * Restringido a roles con responsabilidad de supervisión: dar de alta un lote
 * define qué se está produciendo hoy y es la base de toda la trazabilidad
 * posterior — no es una tarea de captura de piso de planta.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { crearLoteService } from "@/services/calidad/lote.service";
import { ROLES_SUPERVISION_CALIDAD, tieneRol } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

// Status HTTP por code — el contrato {error, code} solo tiene sentido si el
// status distingue "no existe" (404) de "conflicto de negocio" (409) de "bug" (500).
const STATUS_POR_CODE: Record<string, number> = {
  VALIDACION_ESTRUCTURA: 400,
  PRODUCTO_NO_ENCONTRADO: 404,
  PRODUCTO_INACTIVO: 409,
  ERROR_INTERNO: 500,
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado", code: "NO_AUTORIZADO" }, { status: 401 });
  }
  if (!tieneRol(session.user.rol as string | undefined, ROLES_SUPERVISION_CALIDAD)) {
    return NextResponse.json(
      { error: "No tenés permiso para dar de alta un lote", code: "ROL_INSUFICIENTE" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON válido", code: "JSON_INVALIDO" }, { status: 400 });
  }

  const result = await crearLoteService(body, session.user.id);

  if (!result.ok) {
    const status = STATUS_POR_CODE[result.code] ?? 400;
    return NextResponse.json({ error: result.error, code: result.code, details: result.details }, { status });
  }

  return NextResponse.json({ data: result.data }, { status: 201 });
}
