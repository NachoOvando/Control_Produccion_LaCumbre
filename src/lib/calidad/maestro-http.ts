// Helpers compartidos por los endpoints de escritura del maestro. Evita duplicar
// el gate de rol admin y el mapa code→status en las 7 rutas (mismo criterio que
// ROLES_* compartidos en roles.ts).

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ROLES_ADMIN_MAESTRO, tieneRol } from "@/lib/auth/roles";

export const STATUS_POR_CODE: Record<string, number> = {
  VALIDACION_ESTRUCTURA: 400,
  NO_ENCONTRADO: 404,
  PRODUCTO_NO_ENCONTRADO: 404,
  FAMILIA_NO_ENCONTRADA: 404,
  MARCA_NO_ENCONTRADA: 404,
  LINEA_NO_ENCONTRADA: 404,
  BINDING_INEXISTENTE: 409,
  DUPLICADO: 409,
  CONFLICTO_CONCURRENCIA: 409,
  ERROR_INTERNO: 500,
};

// Gate común: sesión válida + rol admin. Devuelve `{ usuarioId }` para seguir, o
// un NextResponse listo para retornar (401/403). El maestro es configuración
// crítica de trazabilidad → solo admin (ADR-015).
export async function gateAdminMaestro(): Promise<{ usuarioId: string } | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado", code: "NO_AUTORIZADO" }, { status: 401 });
  }
  if (!tieneRol(session.user.rol as string | undefined, ROLES_ADMIN_MAESTRO)) {
    return NextResponse.json(
      { error: "Solo un administrador puede modificar el maestro", code: "ROL_INSUFICIENTE" },
      { status: 403 }
    );
  }
  return { usuarioId: session.user.id };
}

// Parseo de body JSON con error amigable. Devuelve el body o un NextResponse 400.
export async function parseBody(req: Request): Promise<unknown | NextResponse> {
  try {
    return await req.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON válido", code: "JSON_INVALIDO" }, { status: 400 });
  }
}

// Traduce el resultado del service a NextResponse. `okStatus` = 201 en altas.
export function responder(
  result: { ok: true; data: unknown } | { ok: false; error: string; code: string; details?: unknown },
  okStatus = 200
): NextResponse {
  if (!result.ok) {
    const status = STATUS_POR_CODE[result.code] ?? 400;
    return NextResponse.json({ error: result.error, code: result.code, details: result.details }, { status });
  }
  return NextResponse.json({ data: result.data }, { status: okStatus });
}
