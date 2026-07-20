/**
 * POST /api/v1/calidad/registros  — registro individual
 * GET  /api/v1/calidad/registros  — historial por línea
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createRegistroService } from "@/services/calidad/registro.service";
import { hoyPlanta } from "@/lib/calidad/fecha-planta";

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

  // Inyectar responsableId desde la sesión — el cliente no puede suplantarlo
  const payload = typeof body === "object" && body !== null
    ? { ...body, responsableId: session.user.id }
    : body;

  const result = await createRegistroService(payload);

  if (!result.ok) {
    // C6 (AUDIT_PLAN.md Lote 2): conflicto de correlativo es un 409, no un 400
    // genérico de validación — le da al cliente una pista real para reintentar.
    const status = result.code === "CONFLICTO_CORRELATIVO" ? 409 : 400;
    return NextResponse.json({ error: result.error, code: result.code, details: result.details }, { status });
  }

  return NextResponse.json({ data: result.data }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado", code: "NO_AUTORIZADO" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const lineaProductivaId = searchParams.get("lineaProductivaId");
  const puntoControlId = searchParams.get("puntoControlId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  if (!lineaProductivaId) {
    return NextResponse.json({ error: "El parámetro lineaProductivaId es obligatorio", code: "PARAM_FALTANTE" }, { status: 400 });
  }

  // Con puntoControlId: registros del día (default hoy) para ese punto en esa línea.
  // Sin DB disponible (modo demo) se responde lista vacía, no error.
  if (puntoControlId) {
    const fecha = searchParams.get("fecha") ?? hoyPlanta();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: "El parámetro fecha debe ser YYYY-MM-DD", code: "PARAM_INVALIDO" }, { status: 400 });
    }
    try {
      const { getRegistrosDelDia } = await import("@/db/calidad.repository");
      const registros = await getRegistrosDelDia(puntoControlId, lineaProductivaId, fecha);
      return NextResponse.json({ data: registros });
    } catch (error) {
      console.error("[GET registros del día] Error de DB:", error);
      // Solo en modo demo explícito se responde lista vacía; en cualquier otro caso
      // un error de DB es un incidente, no "día sin registros" (integridad HACCP).
      if (process.env.DEMO_MODE === "true") {
        return NextResponse.json({ data: [] });
      }
      return NextResponse.json({ error: "Base de datos no disponible", code: "DB_NO_DISPONIBLE" }, { status: 503 });
    }
  }

  const { getRegistrosByLinea } = await import("@/db/calidad.repository");
  const registros = await getRegistrosByLinea(lineaProductivaId, limit);
  return NextResponse.json({ data: registros });
}
