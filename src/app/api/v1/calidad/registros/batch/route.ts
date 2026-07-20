/**
 * POST /api/v1/calidad/registros/batch
 *
 * Ingesta atómica de múltiples registros en una sola transacción.
 * Si cualquier registro falla validación o persistencia, todos se revierten.
 *
 * El responsableId se inyecta desde la sesión del servidor — el cliente no lo envía.
 * Máximo 500 registros por request.
 *
 * Body: RegistroCalidadInput[] (sin responsableId)
 * Response 201: { data: { count: number } }
 * Response 400: { error, code, details }
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
    // genérico de validación.
    const status = result.code === "CONFLICTO_CORRELATIVO" ? 409 : 400;
    return NextResponse.json({ error: result.error, code: result.code, details: result.details }, { status });
  }

  return NextResponse.json({ data: result.data }, { status: 201 });
}
