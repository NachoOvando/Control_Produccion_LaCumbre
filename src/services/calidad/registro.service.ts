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
  esColisionRegistroUnico,
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
    // Conflicto de negocio conocido (C6, AUDIT_PLAN.md Lote 2): con la
    // asignación atómica de nroMuestra esto no debería ocurrir en operación
    // normal, pero se distingue igual de un bug real en vez de ambos caer en
    // ERROR_INTERNO — evita que el operario reintente a ciegas el mismo guardado.
    if (esColisionRegistroUnico(err)) {
      return {
        ok: false,
        error: "Ya existe un registro con ese correlativo para este punto de control. Recargá e intentá de nuevo.",
        code: "CONFLICTO_CORRELATIVO",
      };
    }
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

  // Resolución de turno — una sola query por hora única del batch.
  // Importante: primero se resuelven las horas únicas (awaits secuenciales por hora,
  // no dentro del Promise.all final) para que el cache quede completo antes de mapear.
  // Si se llenara el cache dentro de un único Promise.all sobre `validos`, dos items
  // con la misma hora arrancarían en paralelo y ambos verían el cache vacío antes de
  // que el primero resuelva, disparando la query de turno dos veces para la misma hora.
  const horasUnicas = [...new Set(validos.map((v) => v.data.hora.slice(0, 5)))];
  const turnoCache = new Map<string, string | null>();
  for (const horaKey of horasUnicas) {
    turnoCache.set(horaKey, await getTurnoByHora(horaKey));
  }
  const itemsConTurno: RegistroCalidadInput[] = validos.map((item) => {
    const horaKey = item.data.hora.slice(0, 5); // "HH:MM"
    return { ...item.data, turnoId: turnoCache.get(horaKey) ?? null };
  });

  try {
    const created = await createRegistrosBatchDB(itemsConTurno);
    return { ok: true, data: { count: created.length } };
  } catch (err) {
    // Ver nota equivalente en createRegistroService — C6.
    if (esColisionRegistroUnico(err)) {
      return {
        ok: false,
        error: "Uno o más registros del lote ya existen con ese correlativo. Recargá e intentá de nuevo.",
        code: "CONFLICTO_CORRELATIVO",
      };
    }
    console.error("[registro.service] Error en batch:", err);
    return { ok: false, error: "Error interno al guardar los registros", code: "ERROR_INTERNO" };
  }
}
