/**
 * POST /api/v1/calidad/maestro/especificaciones — crea/versiona una spec de
 * producto (solo admin). Editar no pisa: abre una versión nueva (ver ADR-015).
 */

import { NextRequest } from "next/server";
import { guardarEspecificacionService } from "@/services/calidad/maestro.service";
import { gateAdminMaestro, parseBody, responder } from "@/lib/calidad/maestro-http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await gateAdminMaestro();
  if (gate instanceof Response) return gate;

  const body = await parseBody(req);
  if (body instanceof Response) return body;

  const result = await guardarEspecificacionService(body, gate.usuarioId);
  return responder(result, 201);
}
