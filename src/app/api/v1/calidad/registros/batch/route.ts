/**
 * POST /api/v1/calidad/registros/batch
 *
 * Ingesta atómica de múltiples registros en una sola transacción.
 * Si cualquier registro falla validación o persistencia, todos se revierten.
 *
 * El responsableId se inyecta desde la sesión del servidor — el cliente no lo envía.
 * Máximo 500 registros por request.
 *
 * Idempotencia: si los registros traen `clientRequestId` (UUID generado en el
 * dispositivo al momento de la captura), un reintento del mismo evento NO crea
 * registros nuevos. Se responde 200 en vez de 201 — nada fue creado, pero el
 * dato está guardado, así que para el operario el resultado es exitoso. Esto es
 * lo que corta el duplicado silencioso cuando la respuesta se pierde por un
 * corte de red y el operario vuelve a tocar Guardar.
 *
 * Body: RegistroCalidadInput[] (sin responsableId)
 * Response 201: { data: { count, creados, yaExistian } } — se creó al menos uno
 * Response 200: { data: { count, creados: 0, yaExistian } } — reintento idempotente
 * Response 400: { error, code, details }
 * Response 409: conflicto de correlativo o identificador de captura ajeno
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createRegistrosBatchService } from "@/services/calidad/registro.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado", code: "NO_AUTORIZADO" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON válido", code: "JSON_INVALIDO" }, { status: 400 });
  }

  const result = await createRegistrosBatchService(body, session.user.id, "tablet");

  if (!result.ok) {
    // C6 (AUDIT_PLAN.md Lote 2): conflicto de correlativo es un 409, no un 400
    // genérico de validación. Igual el identificador de captura ajeno: el
    // payload es estructuralmente válido, lo que choca es el estado del recurso.
    const esConflicto =
      result.code === "CONFLICTO_CORRELATIVO" || result.code === "CLIENT_REQUEST_ID_AJENO";
    return NextResponse.json(
      { error: result.error, code: result.code, details: result.details },
      { status: esConflicto ? 409 : 400 }
    );
  }

  // 200 cuando no se creó nada nuevo (reintento idempotente), 201 cuando sí.
  return NextResponse.json({ data: result.data }, { status: result.data.creados > 0 ? 201 : 200 });
}
