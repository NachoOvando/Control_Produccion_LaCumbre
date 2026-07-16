/**
 * GET /api/v1/calidad/lineas
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLineasConPuntosControl } from "@/db/calidad.repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado", code: "NO_AUTORIZADO" }, { status: 401 });
  }

  const lineas = await getLineasConPuntosControl("calidad");

  const data = lineas.map((l) => ({
    id: l.id,
    nombre: l.nombre,
    descripcion: l.descripcion,
    puntosControl: l.puntosControl.map((pcl) => ({
      id: pcl.puntoControl.id,
      nombre: pcl.puntoControl.nombre,
      descripcion: pcl.puntoControl.descripcion,
      tipoFormulario: pcl.puntoControl.tipoFormulario,
      orden: pcl.orden,
    })),
  }));

  return NextResponse.json({ data });
}
