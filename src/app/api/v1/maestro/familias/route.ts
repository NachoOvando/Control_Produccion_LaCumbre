/**
 * POST /api/v1/maestro/familias — alta de familia (solo admin).
 */

import { NextRequest } from "next/server";
import { crearFamiliaService } from "@/services/calidad/maestro.service";
import { gateAdminMaestro, parseBody, responder } from "@/lib/calidad/maestro-http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await gateAdminMaestro();
  if (gate instanceof Response) return gate;

  const body = await parseBody(req);
  if (body instanceof Response) return body;

  const result = await crearFamiliaService(body, gate.usuarioId);
  return responder(result, 201);
}
