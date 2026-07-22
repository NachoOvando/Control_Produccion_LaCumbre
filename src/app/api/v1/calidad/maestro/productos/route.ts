/**
 * POST /api/v1/calidad/maestro/productos — alta de producto (solo admin).
 */

import { NextRequest } from "next/server";
import { crearProductoService } from "@/services/calidad/maestro.service";
import { gateAdminMaestro, parseBody, responder } from "@/lib/calidad/maestro-http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await gateAdminMaestro();
  if (gate instanceof Response) return gate;

  const body = await parseBody(req);
  if (body instanceof Response) return body;

  const result = await crearProductoService(body, gate.usuarioId);
  return responder(result, 201);
}
