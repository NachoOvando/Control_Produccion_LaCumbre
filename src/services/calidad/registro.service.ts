/**
 * Service layer — Registros de calidad
 *
 * Responsabilidades:
 *   1. Validar el payload con Zod (tipos, campos requeridos).
 *   2. Recuperar el schema_json del punto de control.
 *   3. Validar el campo `data` contra ese schema con AJV.
 *   4. Resolver automáticamente el turnoId según la hora del registro.
 *   5. Delegar la escritura al repository.
 *
 * Esta capa NO importa componentes React ni accede a cookies/headers de Next.js.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateAgainstSchema } from "@/lib/validate-jsonb";
import {
  createRegistroCalidad,
  createRegistrosBatchDB,
  getTurnoByHora,
} from "@/db/calidad.repository";
import type { RegistroCalidadInput } from "@/types/calidad";

// Schema Zod para un registro individual — usado tanto en single como en batch
const RegistroInputSchema = z.object({
  puntoControlId: z.string().uuid("puntoControlId debe ser UUID"),
  loteId: z.string().uuid("loteId debe ser UUID"),
  lineaProductivaId: z.string().uuid("lineaProductivaId debe ser UUID"),
  responsableId: z.string().uuid("responsableId debe ser UUID"),
  fuenteOrigen: z.enum(["tablet", "api_externa", "scada_opcua", "scada_mqtt", "importacion"]).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha debe tener formato YYYY-MM-DD"),
  hora: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "hora debe tener formato HH:mm o HH:mm:ss"),
  nroMuestra: z.number().int().min(1, "nroMuestra debe ser mayor a 0"),
  filaProd: z.number().int().min(1).optional(),
  notas: z.string().max(1000).optional(),
  data: z.record(z.string(), z.unknown()),
});

export type CreateRegistroResult =
  | { ok: true; data: Awaited<ReturnType<typeof createRegistroCalidad>> }
  | { ok: false; error: string; code: string; details?: unknown };

export type BatchRegistroResult =
  | { ok: true; data: { count: number } }
  | { ok: false; error: string; code: string; details?: unknown };

export async function createRegistroService(rawInput: unknown): Promise<CreateRegistroResult> {
  const parsed = RegistroInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos del registro inválidos",
      code: "VALIDACION_ESTRUCTURA",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const input = parsed.data as RegistroCalidadInput;

  const puntoControl = await prisma.puntoControl.findUnique({
    where: { id: input.puntoControlId },
    select: { schemaJson: true, activo: true, nombre: true },
  });

  if (!puntoControl) return { ok: false, error: "Punto de control no encontrado", code: "PUNTO_CONTROL_NO_ENCONTRADO" };
  if (!puntoControl.activo) return { ok: false, error: "El punto de control está inactivo", code: "PUNTO_CONTROL_INACTIVO" };

  const jsonbValidation = validateAgainstSchema(input.data, puntoControl.schemaJson);
  if (!jsonbValidation.valid) {
    return {
      ok: false,
      error: `Datos del punto de control '${puntoControl.nombre}' inválidos`,
      code: "VALIDACION_DATOS",
      details: jsonbValidation.errors,
    };
  }

  const [lote, linea] = await Promise.all([
    prisma.lote.findUnique({ where: { id: input.loteId }, select: { id: true } }),
    prisma.lineaProductiva.findUnique({ where: { id: input.lineaProductivaId }, select: { id: true } }),
  ]);

  if (!lote) return { ok: false, error: "Lote no encontrado", code: "LOTE_NO_ENCONTRADO" };
  if (!linea) return { ok: false, error: "Línea productiva no encontrada", code: "LINEA_NO_ENCONTRADA" };

  // Resolución automática de turno según la hora del registro
  const turnoId = await getTurnoByHora(input.hora);

  try {
    const registro = await createRegistroCalidad({ ...input, turnoId });
    return { ok: true, data: registro };
  } catch (err) {
    console.error("[registro.service] Error al persistir:", err);
    return { ok: false, error: "Error interno al guardar el registro", code: "ERROR_INTERNO" };
  }
}

// Batch: recibe array de registros sin responsableId (se inyecta desde la sesión del servidor).
// Valida estructura + JSONB de cada item, resuelve turno, y persiste en una transacción.
export async function createRegistrosBatchService(
  rawItems: unknown,
  responsableId: string,
  fuenteOrigen: "tablet" | "api_externa" | "scada_opcua" | "scada_mqtt" | "importacion" = "tablet"
): Promise<BatchRegistroResult> {
  if (!Array.isArray(rawItems)) {
    return { ok: false, error: "El cuerpo debe ser un array de registros", code: "FORMATO_INVALIDO" };
  }
  if (rawItems.length === 0) {
    return { ok: false, error: "El array no puede estar vacío", code: "ARRAY_VACIO" };
  }
  if (rawItems.length > 500) {
    return { ok: false, error: "Máximo 500 registros por batch", code: "BATCH_DEMASIADO_GRANDE" };
  }

  // Inyectar responsableId y fuenteOrigen desde el servidor (no del cliente)
  const itemsConResponsable = rawItems.map((item) => ({
    ...(typeof item === "object" && item !== null ? item : {}),
    responsableId,
    fuenteOrigen,
  }));

  // Validar estructura de cada item con Zod
  const parseResults = itemsConResponsable.map((item, idx) => {
    const r = RegistroInputSchema.safeParse(item);
    if (!r.success) {
      return { ok: false as const, index: idx, errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
    }
    return { ok: true as const, index: idx, data: r.data as RegistroCalidadInput };
  });

  const invalidos = parseResults.filter((r) => !r.ok);
  if (invalidos.length > 0) {
    return { ok: false, error: `${invalidos.length} registro(s) con estructura inválida`, code: "VALIDACION_BATCH", details: invalidos };
  }

  const validos = parseResults.filter((r) => r.ok) as { ok: true; index: number; data: RegistroCalidadInput }[];

  // Cargar schemas de los puntos de control únicos del batch
  const puntoControlIds = [...new Set(validos.map((v) => v.data.puntoControlId))];
  const puntosControl = await prisma.puntoControl.findMany({
    where: { id: { in: puntoControlIds } },
    select: { id: true, schemaJson: true, nombre: true, activo: true },
  });
  const pcMap = new Map(puntosControl.map((pc) => [pc.id, pc]));

  // Validar data JSONB de cada item
  const erroresJsonb: { index: number; error: string }[] = [];
  for (const item of validos) {
    const pc = pcMap.get(item.data.puntoControlId);
    if (!pc) {
      erroresJsonb.push({ index: item.index, error: "Punto de control no encontrado" });
      continue;
    }
    if (!pc.activo) {
      erroresJsonb.push({ index: item.index, error: `Punto de control '${pc.nombre}' está inactivo` });
      continue;
    }
    const v = validateAgainstSchema(item.data.data, pc.schemaJson);
    if (!v.valid) {
      erroresJsonb.push({ index: item.index, error: v.errors?.join(", ") ?? "Datos inválidos" });
    }
  }
  if (erroresJsonb.length > 0) {
    return { ok: false, error: `${erroresJsonb.length} registro(s) con datos inválidos`, code: "VALIDACION_DATOS", details: erroresJsonb };
  }

  // Resolución de turno — una sola query para todas las horas del batch
  const turnoCache = new Map<string, string | null>();
  const itemsConTurno: RegistroCalidadInput[] = await Promise.all(
    validos.map(async (item) => {
      const horaKey = item.data.hora.slice(0, 5); // "HH:MM"
      if (!turnoCache.has(horaKey)) {
        turnoCache.set(horaKey, await getTurnoByHora(item.data.hora));
      }
      return { ...item.data, turnoId: turnoCache.get(horaKey) ?? null };
    })
  );

  try {
    const created = await createRegistrosBatchDB(itemsConTurno);
    return { ok: true, data: { count: created.length } };
  } catch (err) {
    console.error("[registro.service] Error en batch:", err);
    return { ok: false, error: "Error interno al guardar los registros", code: "ERROR_INTERNO" };
  }
}
