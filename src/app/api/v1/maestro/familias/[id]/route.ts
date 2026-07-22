/**
 * PATCH /api/v1/maestro/familias/:id — edición de familia (solo admin).
 */

import { NextRequest } from "next/server";
import { actualizarFamiliaService } from "@/services/calidad/maestro.service";
import { gateAdminMaestro, parseBody, responder } from "@/lib/calidad/maestro-http";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateAdminMaestro();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const body = await parseBody(req);
  if (body instanceof Response) return body;

  const result = await actualizarFamiliaService(id, body, gate.usuarioId);
  return responder(result);
}
