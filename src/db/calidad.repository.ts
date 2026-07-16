/**
 * Repository layer — Calidad
 * Toda query de calidad pasa por aquí. Sin lógica de negocio.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { RegistroCalidadInput } from "@/types/calidad";

export async function getLineasConPuntosControl(modulo = "calidad") {
  return prisma.lineaProductiva.findMany({
    where: { activa: true, modulo: modulo as "calidad" | "produccion" | "deposito" },
    include: {
      puntosControl: {
        include: {
          puntoControl: {
            include: { familias: { include: { familia: true } } },
          },
        },
        orderBy: { orden: "asc" },
      },
    },
    orderBy: { nombre: "asc" },
  });
}

export async function getRelacionPuntoLinea(puntoControlId: string, lineaProductivaId: string) {
  return prisma.puntoControlLinea.findUnique({
    where: { puntoControlId_lineaProductivaId: { puntoControlId, lineaProductivaId } },
    include: { puntoControl: true, lineaProductiva: true },
  });
}

export async function getPuntoControlById(id: string) {
  return prisma.puntoControl.findUnique({
    where: { id },
    include: { lineas: { include: { lineaProductiva: true } } },
  });
}

// Catálogo de productos activos para el selector de Alta de Lote.
export async function getProductosActivos() {
  return prisma.producto.findMany({
    where: { activo: true },
    include: { familia: true, marca: true },
    orderBy: { nombre: "asc" },
  });
}

// Alta de lote. El alta es una acción manual de baja frecuencia (un supervisor
// dando de alta unas pocas veces por día) — no justifica una tabla de
// secuencias como la prevista para pallet_numero/nroMuestra (ver ADR-006). Basta
// con generar + intentar insertar, reintentando ante colisión de `numeroLote`.
//
// PLACEHOLDER: el formato `GEN-{yyyyMMdd}-{HHmmss}` es temporal. Las reglas
// reales de numeración de lote (por producto / línea de negocio) las define el
// usuario más adelante — no usar este formato como referencia para
// integraciones ni reportes a Arcor. No confundir con `Producto.nomenclaturaLote`
// (usado en `lote-pt.ts` para el lote de PT del pallet en Producción Diaria):
// son dos números con propósitos distintos — este identifica la corrida de
// producción en curso, aquel el lote de producto terminado en el pallet.
function generarNumeroLoteGenerico(fechaProduccion: Date): string {
  const yyyy = fechaProduccion.getFullYear();
  const mm = String(fechaProduccion.getMonth() + 1).padStart(2, "0");
  const dd = String(fechaProduccion.getDate()).padStart(2, "0");
  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, "0");
  const min = String(ahora.getMinutes()).padStart(2, "0");
  const ss = String(ahora.getSeconds()).padStart(2, "0");
  return `GEN-${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

// `meta.target` viene tipado `unknown` por Prisma; con el driver adapter de pg
// se observó como array de columnas, pero no está garantizado — normalizamos
// ambas formas y logueamos si un P2002 no matchea el patrón esperado, para
// detectar drift en vez de fallar en silencio.
function columnasDeColision(e: unknown): string[] | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const target = e.meta?.target;
  return Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
}

function esColisionNumeroLote(e: unknown): boolean {
  const columnas = columnasDeColision(e);
  if (columnas === null) return false;
  const esNumeroLote = columnas.includes("numero_lote");
  if (!esNumeroLote) {
    console.warn("[crearLote] P2002 sin match esperado en numero_lote — meta.target:", columnas);
  }
  return esNumeroLote;
}

// Colisión contra @@unique([productoId, lineaProductivaId, fechaProduccion]) —
// dos activaciones concurrentes del mismo producto/línea/día es una carrera de
// negocio benigna (perdimos contra otro request que ya creó el lote), no un error.
function esColisionLoteLinea(e: unknown): boolean {
  const columnas = columnasDeColision(e);
  if (columnas === null) return false;
  return (
    columnas.includes("producto_id") &&
    columnas.includes("linea_productiva_id") &&
    columnas.includes("fecha_produccion")
  );
}

export async function crearLote(
  productoId: string,
  fechaProduccion: Date,
  notas?: string,
  creadoPorId?: string,
  lineaProductivaId?: string
) {
  for (let intento = 0; intento < 3; intento++) {
    const numeroLote = generarNumeroLoteGenerico(fechaProduccion);
    try {
      return await prisma.lote.create({
        data: { numeroLote, productoId, fechaProduccion, notas, creadoPorId, lineaProductivaId },
        include: { producto: true },
      });
    } catch (e) {
      if (esColisionNumeroLote(e) && intento < 2) continue;
      throw e;
    }
  }
  throw new Error("No se pudo generar un número de lote único tras varios intentos");
}

// Producto/lote activo de una línea — reemplaza a la vieja heurística basada en
// el último RegistroCalidad del día (getLoteEnCursoDeLinea, retirada). La
// selección ahora es explícita y persistida en LineaProduccionEstado, no
// inferida. Si el puntero es de un día anterior, se trata como "sin producto
// activo hoy" — no arrastra el producto de ayer.
export async function getProductoActivoDeLinea(lineaProductivaId: string, fecha: string) {
  const estado = await prisma.lineaProduccionEstado.findUnique({
    where: { lineaProductivaId },
    include: {
      loteActivo: { include: { producto: { include: { familia: true } } } },
      activadoPor: { select: { id: true, nombre: true } },
    },
  });
  if (!estado) return null;

  const fechaLote = estado.loteActivo.fechaProduccion.toISOString().slice(0, 10);
  if (fechaLote !== fecha) return null;

  return estado;
}

// Activa (o reactiva) el producto de una línea. Si ya existe un lote de ese
// producto/línea/día (changeover de ida y vuelta), lo reutiliza en vez de crear
// uno nuevo — la @@unique([productoId, lineaProductivaId, fechaProduccion]) en
// Lote es la que hace posible este find-or-create. Registra la activación en
// LineaActivacionLog (append-only) además de mover el puntero mutable.
export async function activarProductoLinea(
  lineaProductivaId: string,
  productoId: string,
  usuarioId: string,
  fechaProduccion: Date
) {
  const buscarExistente = () =>
    prisma.lote.findUnique({
      where: {
        productoId_lineaProductivaId_fechaProduccion: { productoId, lineaProductivaId, fechaProduccion },
      },
      include: { producto: true },
    });

  let lote = await buscarExistente();

  if (!lote) {
    try {
      lote = await crearLote(productoId, fechaProduccion, undefined, usuarioId, lineaProductivaId);
    } catch (e) {
      // Dos activaciones concurrentes del mismo producto/línea/día: perdimos la
      // carrera contra otro request que ya insertó el lote entre el findUnique
      // y el create — reusar el que ganó en vez de fallar con 500.
      if (!esColisionLoteLinea(e)) throw e;
      lote = await buscarExistente();
      if (!lote) throw e;
    }
  }

  const activadoEn = new Date();
  const [estado] = await prisma.$transaction([
    prisma.lineaProduccionEstado.upsert({
      where: { lineaProductivaId },
      update: { loteActivoId: lote.id, activadoPorId: usuarioId, activadoEn },
      create: { lineaProductivaId, loteActivoId: lote.id, activadoPorId: usuarioId, activadoEn },
      include: {
        loteActivo: { include: { producto: { include: { familia: true } } } },
        activadoPor: { select: { id: true, nombre: true } },
      },
    }),
    prisma.lineaActivacionLog.create({
      data: { lineaProductivaId, loteId: lote.id, usuarioId },
    }),
  ]);

  return estado;
}

// Resuelve en qué turno cae una hora dada (formato "HH:MM" o "HH:MM:SS").
// Maneja turnos que cruzan medianoche (ej. Noche 22:00-06:00).
// Retorna null si no hay turnos configurados o si la DB no está disponible.
export async function getTurnoByHora(horaStr: string): Promise<string | null> {
  try {
    const turnos = await prisma.turno.findMany({ where: { activo: true } });
    const partes = horaStr.split(":");
    const minutos = parseInt(partes[0]) * 60 + parseInt(partes[1]);

    for (const turno of turnos) {
      const [iH, iM] = turno.horaInicio.split(":").map(Number);
      const [fH, fM] = turno.horaFin.split(":").map(Number);
      const inicio = iH * 60 + iM;
      const fin = fH * 60 + fM;

      if (inicio < fin) {
        // Rango normal (ej. 06:00-14:00)
        if (minutos >= inicio && minutos < fin) return turno.id;
      } else {
        // Rango que cruza medianoche (ej. 22:00-06:00)
        if (minutos >= inicio || minutos < fin) return turno.id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Auditoría HACCP
// Append-only: nunca se llama update ni delete sobre auditoria_registros.
// -----------------------------------------------------------------------------

export async function registrarAuditoria(params: {
  registroCalidadId: string;
  accion: "crear" | "modificar" | "eliminar" | "restaurar";
  usuarioId: string;
  datosAntes?: object | null;
  datosDespues?: object | null;
  ipOrigen?: string | null;
  motivo?: string | null;
}) {
  return prisma.auditoriaRegistro.create({
    data: {
      registroCalidadId: params.registroCalidadId,
      accion: params.accion,
      usuarioId: params.usuarioId,
      datosAntes: params.datosAntes ?? undefined,
      datosDespues: params.datosDespues ?? undefined,
      ipOrigen: params.ipOrigen ?? null,
      motivo: params.motivo ?? null,
    },
  });
}

export async function softDeleteRegistro(params: {
  registroId: string;
  usuarioId: string;
  motivo: string;
  ipOrigen?: string | null;
}) {
  const registro = await prisma.registroCalidad.findUnique({
    where: { id: params.registroId },
  });
  if (!registro || registro.deletedAt) return null;

  const [updated] = await prisma.$transaction([
    prisma.registroCalidad.update({
      where: { id: params.registroId },
      data: { deletedAt: new Date(), deletedById: params.usuarioId },
    }),
    prisma.auditoriaRegistro.create({
      data: {
        registroCalidadId: params.registroId,
        accion: "eliminar",
        usuarioId: params.usuarioId,
        datosAntes: registro as object,
        ipOrigen: params.ipOrigen ?? null,
        motivo: params.motivo,
      },
    }),
  ]);
  return updated;
}

export async function registrarCambioEstadoLote(params: {
  loteId: string;
  estadoAnterior: string;
  estadoNuevo: string;
  usuarioId: string;
  motivo?: string | null;
}) {
  return prisma.loteEstadoLog.create({
    data: {
      loteId: params.loteId,
      estadoAnterior: params.estadoAnterior as "en_produccion" | "en_espera" | "aprobado" | "rechazado" | "en_cuarentena",
      estadoNuevo: params.estadoNuevo as "en_produccion" | "en_espera" | "aprobado" | "rechazado" | "en_cuarentena",
      usuarioId: params.usuarioId,
      motivo: params.motivo ?? null,
    },
  });
}

export async function createRegistroCalidad(input: RegistroCalidadInput) {
  return prisma.registroCalidad.create({
    data: {
      puntoControlId: input.puntoControlId,
      loteId: input.loteId,
      lineaProductivaId: input.lineaProductivaId,
      responsableId: input.responsableId,
      turnoId: input.turnoId ?? null,
      fuenteOrigen: (input.fuenteOrigen as "tablet" | "api_externa" | "scada_opcua" | "scada_mqtt" | "importacion") ?? "tablet",
      fecha: new Date(input.fecha),
      hora: new Date(`1970-01-01T${input.hora}Z`),
      nroMuestra: input.nroMuestra,
      filaProd: input.filaProd ?? null,
      notas: input.notas ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: input.data as any,
    },
    include: {
      puntoControl: true,
      lote: { include: { producto: true } },
      lineaProductiva: true,
      responsable: { select: { id: true, nombre: true } },
      turno: { select: { id: true, nombre: true } },
    },
  });
}

// Persiste un batch de registros + sus entradas de auditoría en una sola transacción.
// Si cualquier operación falla, todo se revierte (atomicidad HACCP).
export async function createRegistrosBatchDB(inputs: RegistroCalidadInput[]) {
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  for (const input of inputs) {
    const registroId = crypto.randomUUID();
    const data = {
      puntoControlId: input.puntoControlId,
      loteId: input.loteId,
      lineaProductivaId: input.lineaProductivaId,
      responsableId: input.responsableId,
      turnoId: input.turnoId ?? null,
      fuenteOrigen: (input.fuenteOrigen as "tablet" | "api_externa" | "scada_opcua" | "scada_mqtt" | "importacion") ?? "tablet",
      fecha: new Date(input.fecha),
      hora: new Date(`1970-01-01T${input.hora}Z`),
      nroMuestra: input.nroMuestra,
      filaProd: input.filaProd ?? null,
      notas: input.notas ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: input.data as any,
    };

    ops.push(
      prisma.registroCalidad.create({ data: { id: registroId, ...data } })
    );
    ops.push(
      prisma.auditoriaRegistro.create({
        data: {
          registroCalidadId: registroId,
          accion: "crear",
          usuarioId: input.responsableId,
          datosDespues: data as object,
        },
      })
    );
  }

  return prisma.$transaction(ops);
}

export async function getRegistrosByLoteYPuntoControl(loteId: string, puntoControlId: string) {
  return prisma.registroCalidad.findMany({
    where: { loteId, puntoControlId, deletedAt: null },
    include: {
      responsable: { select: { id: true, nombre: true } },
      lote: { include: { producto: true } },
      lineaProductiva: true,
      turno: { select: { id: true, nombre: true } },
    },
    orderBy: [{ fecha: "desc" }, { hora: "desc" }],
  });
}

// Registros de un punto de control en una línea para una fecha (default: la del string "YYYY-MM-DD").
// Alimenta la lista "registros del día" de los formularios y los derivados en cliente
// (max pallet del día, tiempo de túnel ya cargado).
export async function getRegistrosDelDia(
  puntoControlId: string,
  lineaProductivaId: string,
  fecha: string
) {
  return prisma.registroCalidad.findMany({
    where: {
      puntoControlId,
      lineaProductivaId,
      fecha: new Date(fecha),
      deletedAt: null,
    },
    include: {
      responsable: { select: { id: true, nombre: true } },
      lote: { include: { producto: true } },
      turno: { select: { id: true, nombre: true } },
    },
    orderBy: [{ hora: "desc" }],
  });
}

export async function getRegistrosByLinea(lineaProductivaId: string, limit = 50) {
  return prisma.registroCalidad.findMany({
    where: { lineaProductivaId, deletedAt: null },
    include: {
      puntoControl: true,
      responsable: { select: { id: true, nombre: true } },
      lote: { include: { producto: true } },
      turno: { select: { id: true, nombre: true } },
    },
    orderBy: [{ fecha: "desc" }, { hora: "desc" }],
    take: limit,
  });
}
