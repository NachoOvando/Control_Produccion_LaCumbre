/**
 * GET /api/v1/calidad/puntos-control?lineaId=...
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado", code: "NO_AUTORIZADO" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const lineaId = searchParams.get("lineaId");

  if (!lineaId) {
    return NextResponse.json({ error: "El parámetro lineaId es obligatorio", code: "PARAM_FALTANTE" }, { status: 400 });
  }

  const relaciones = await prisma.puntoControlLinea.findMany({
    where: { lineaProductivaId: lineaId },
    include: { puntoControl: true },
    orderBy: { orden: "asc" },
  });

  const puntosControl = relaciones.map((r) => ({
    id: r.puntoControl.id,
    nombre: r.puntoControl.nombre,
    descripcion: r.puntoControl.descripcion,
    tipoFormulario: r.puntoControl.tipoFormulario,
    schemaJson: r.puntoControl.schemaJson,
    orden: r.orden,
  }));

  return NextResponse.json({ data: puntosControl });
}
