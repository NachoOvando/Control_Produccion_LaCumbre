/**
 * Repository layer — Calidad
 * Toda query de calidad pasa por aquí. Sin lógica de negocio.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { RegistroCalidadInput } from "@/types/calidad";
import { horaPlanta } from "@/lib/calidad/fecha-planta";
import { generarNumeroLote } from "@/lib/calidad/lote-numero";

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
// Formato definitivo (2026-07-16, ver generarNumeroLote en lote-numero.ts):
// `L-DD/MM/AAAA-AJJJ-hh:mm-ENV`, requiere vidaUtilMeses del producto y código
// de línea — se usa siempre que crearLote() reciba `lineaCodigo`. El alta
// MANUAL de lote (`/calidad/lotes/nuevo`) hoy no asocia línea productiva (ver
// `CrearLoteInputSchema` en lote.service.ts) — decisión explícita del usuario:
// ese camino no ocurre en la práctica desde que existe "producto activo por
// línea" (ADR-012), así que sigue con el placeholder `GEN-{fecha}-{hora}` hasta
// que se defina una línea para ese flujo. No confundir con
// `Producto.nomenclaturaLote` (usado en `lote-pt.ts` para el lote de PT del
// pallet en Producción Diaria): son dos números con propósitos distintos.
// `fechaProduccion` debe llegar ya reconstruida a getters locales (ver
// `fechaCalendario` en crearLote) — este helper no reparsea ninguna zona horaria.
function generarNumeroLoteGenerico(fechaProduccion: Date, sufijo?: string): string {
  const yyyy = fechaProduccion.getFullYear();
  const mm = String(fechaProduccion.getMonth() + 1).padStart(2, "0");
  const dd = String(fechaProduccion.getDate()).padStart(2, "0");
  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, "0");
  const min = String(ahora.getMinutes()).padStart(2, "0");
  const ss = String(ahora.getSeconds()).padStart(2, "0");
  const base = `GEN-${yyyy}${mm}${dd}-${hh}${min}${ss}`;
  return sufijo ? `${base}${sufijo}` : base;
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

// Colisión contra la constraint única "registro_unico" (puntoControlId, loteId,
// fecha, nroMuestra, filaProd) — con la asignación atómica de nroMuestra (ver
// siguienteValorSecuencia) esto no debería dispararse en operación normal; se
// detecta igual como defensa en profundidad (ver C6, AUDIT_PLAN.md Lote 2) para
// no mapear un conflicto de negocio conocido al mismo ERROR_INTERNO genérico
// que un bug real. `meta.target` puede venir como array de columnas o, para
// constraints con nombre explícito, como el nombre de la constraint.
export function esColisionRegistroUnico(e: unknown): boolean {
  const columnas = columnasDeColision(e);
  if (columnas === null) return false;
  if (columnas.length === 1 && columnas[0] === "registro_unico") return true;
  return (
    columnas.includes("punto_control_id") &&
    columnas.includes("lote_id") &&
    columnas.includes("fecha") &&
    columnas.includes("nro_muestra")
  );
}

// Asigna de forma atómica el próximo valor de una secuencia diaria
// (pallet_numero/nroMuestra, ver ADR-006 en docs/architecture.md). `tipo` es el
// puntoControlId: dos puntos de control en la misma línea tienen secuencias
// independientes, igual que ya exige la constraint registro_unico. Debe
// ejecutarse dentro de la MISMA transacción que persiste el/los registros —
// recibe el `tx` en vez de usar el `prisma` global. Devuelve el valor asignado
// (ya incrementado), no el anterior.
async function siguienteValorSecuencia(
  tx: Prisma.TransactionClient,
  params: { lineaProductivaId: string; fecha: string; tipo: string }
): Promise<number> {
  const { lineaProductivaId, fecha, tipo } = params;
  const rows = await tx.$queryRaw<{ ultimo_valor: number }[]>`
    INSERT INTO secuencias_diarias (linea_productiva_id, fecha, tipo, ultimo_valor)
    VALUES (${lineaProductivaId}::uuid, ${fecha}::date, ${tipo}, 1)
    ON CONFLICT (linea_productiva_id, fecha, tipo)
    DO UPDATE SET ultimo_valor = secuencias_diarias.ultimo_valor + 1
    RETURNING ultimo_valor
  `;
  const ultimoValor = rows[0]?.ultimo_valor;
  if (typeof ultimoValor !== "number") {
    throw new Error("siguienteValorSecuencia: no se pudo leer ultimo_valor tras el upsert atómico");
  }
  return ultimoValor;
}

export async function crearLote(params: {
  productoId: string;
  fechaProduccion: Date;
  // Presentes solo en el flujo automático (activarProductoLinea) — habilitan
  // el formato definitivo. Ausentes → placeholder legacy (ver comentario arriba).
  vidaUtilMeses?: number | null;
  lineaCodigo?: number | null;
  notas?: string;
  creadoPorId?: string;
  lineaProductivaId?: string;
}) {
  const { productoId, fechaProduccion, vidaUtilMeses, lineaCodigo, notas, creadoPorId, lineaProductivaId } = params;

  // fechaProduccion llega parseada como UTC (viene de un string "yyyy-MM-dd" vía
  // jornadaProductiva()/hoyPlanta() en los callers — ver esos comentarios), pero
  // AMBOS generadores de numeroLote (nuevo y legacy) leen el día con getters
  // LOCALES. Mezclar ambos corre el día calendario según el desfasaje horario de
  // la máquina — se reconstruye una sola vez, para los dos caminos, con getters
  // UTC hacia un Date de constructor local con el mismo año/mes/día.
  const fechaCalendario = new Date(
    fechaProduccion.getUTCFullYear(),
    fechaProduccion.getUTCMonth(),
    fechaProduccion.getUTCDate()
  );

  for (let intento = 0; intento < 3; intento++) {
    // Ambos formatos son determinísticos dentro de su granularidad (minuto el
    // nuevo, segundo el legacy) — en reintento por colisión real se agrega un
    // sufijo de desambiguación en vez de confiar en que cambie solo.
    const sufijo = intento > 0 ? `-${String(intento + 1).padStart(2, "0")}` : undefined;
    let numeroLote: string;
    if (lineaCodigo != null) {
      // Bloqueado ya en la capa de service si falta vidaUtilMeses — este throw
      // es defensivo (bug de programación, no un caso de negocio esperado).
      if (vidaUtilMeses == null) {
        throw new Error("crearLote: lineaCodigo presente sin vidaUtilMeses — debía bloquearse en el service");
      }
      numeroLote = generarNumeroLote({
        fechaProduccion: fechaCalendario,
        vidaUtilMeses,
        lineaCodigo,
        horaRegistro: horaPlanta(),
        sufijo,
      });
    } else {
      numeroLote = generarNumeroLoteGenerico(fechaCalendario, sufijo);
    }
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
export async function activarProductoLinea(params: {
  lineaProductivaId: string;
  productoId: string;
  usuarioId: string;
  fechaProduccion: Date;
  // Resueltos por el service (ya validados: vidaUtilMeses no-null es
  // obligatorio ahí antes de llegar acá) — habilitan el numeroLote definitivo.
  // Objeto param a propósito: dos number|null consecutivos como posicionales
  // son fáciles de invertir sin que TypeScript lo detecte.
  vidaUtilMeses: number | null;
  lineaCodigo: number | null;
}) {
  const { lineaProductivaId, productoId, usuarioId, fechaProduccion, vidaUtilMeses, lineaCodigo } = params;

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
      lote = await crearLote({
        productoId,
        fechaProduccion,
        vidaUtilMeses,
        lineaCodigo,
        creadoPorId: usuarioId,
        lineaProductivaId,
      });
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
  } catch (e) {
    // No hay turnos activos es un estado de negocio legítimo (tabla `turnos` vacía o
    // sin ninguno con `activo=true`) y no debería llegar acá: el findMany no lanza en
    // ese caso, simplemente devuelve []. Cualquier excepción real en este catch es una
    // falla de infraestructura (conexión caída, timeout, etc.) — la logueamos para no
    // perder el rastro de por qué un registro quedó sin turno asignado.
    console.error("[getTurnoByHora] error consultando turnos activos, registro quedará sin turno asignado:", e);
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

// Con la asignación atómica del correlativo (ver ADR-006), `input.nroMuestra`
// deja de ser el valor persistido: si `input.data` trae la clave
// `pallet_numero`, se sincroniza con el valor real asignado por el servidor
// (son el mismo concepto de negocio para Producción Diaria — ver ADR-006).
function dataConCorrelativoSincronizado(data: Record<string, unknown>, nroMuestra: number): Record<string, unknown> {
  if (!("pallet_numero" in data)) return data;
  return { ...data, pallet_numero: nroMuestra };
}

export async function createRegistroCalidad(input: RegistroCalidadInput) {
  return prisma.$transaction(async (tx) => {
    const nroMuestra = await siguienteValorSecuencia(tx, {
      lineaProductivaId: input.lineaProductivaId,
      fecha: input.fecha,
      tipo: input.puntoControlId,
    });

    return tx.registroCalidad.create({
      data: {
        puntoControlId: input.puntoControlId,
        loteId: input.loteId,
        lineaProductivaId: input.lineaProductivaId,
        responsableId: input.responsableId,
        turnoId: input.turnoId ?? null,
        fuenteOrigen: (input.fuenteOrigen as "tablet" | "api_externa" | "scada_opcua" | "scada_mqtt" | "importacion") ?? "tablet",
        fecha: new Date(input.fecha),
        hora: new Date(`1970-01-01T${input.hora}Z`),
        nroMuestra,
        filaProd: input.filaProd ?? null,
        notas: input.notas ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: dataConCorrelativoSincronizado(input.data, nroMuestra) as any,
      },
      include: {
        puntoControl: true,
        lote: { include: { producto: true } },
        lineaProductiva: true,
        responsable: { select: { id: true, nombre: true } },
        turno: { select: { id: true, nombre: true } },
      },
    });
  });
}

// Persiste un batch de registros + sus entradas de auditoría en una sola transacción.
// Si cualquier operación falla, todo se revierte (atomicidad HACCP).
//
// nroMuestra (ver ADR-006, AUDIT_PLAN.md Lote 2 — C5): el valor que llega en
// `input.nroMuestra` YA NO es el valor final persistido — el cliente lo sigue
// mandando (sin tocar los 8 formularios) pero acá se usa SOLO como clave de
// agrupación *dentro de este mismo batch*: filas con igual
// (lineaProductivaId, puntoControlId, fecha, nroMuestra-enviado) comparten un
// mismo pallet/muestra (ver DefectosConformadoForm: 12 filas de una muestra
// comparten nroMuestra y difieren en filaProd) y reciben UN solo valor
// asignado atómicamente vía secuencias_diarias. El orden de asignación sigue
// el orden de aparición del grupo en el batch. Esto además resuelve B1: como
// la secuencia persiste entre requests, un segundo guardado el mismo día
// continúa desde donde quedó la anterior — no puede colisionar.
export async function createRegistrosBatchDB(inputs: RegistroCalidadInput[]) {
  return prisma.$transaction(async (tx) => {
    const claveDe = (i: RegistroCalidadInput) =>
      `${i.lineaProductivaId}|${i.puntoControlId}|${i.fecha}|${i.nroMuestra}`;

    // Un solo incremento de secuencia por grupo único (no por fila) — el orden
    // de un Map de JS preserva el orden de inserción, así que el primer grupo
    // en aparecer recibe el número más bajo.
    const gruposVistos = new Map<string, { lineaProductivaId: string; fecha: string; puntoControlId: string }>();
    for (const input of inputs) {
      const clave = claveDe(input);
      if (!gruposVistos.has(clave)) {
        gruposVistos.set(clave, {
          lineaProductivaId: input.lineaProductivaId,
          fecha: input.fecha,
          puntoControlId: input.puntoControlId,
        });
      }
    }

    const nroMuestraAsignado = new Map<string, number>();
    for (const [clave, g] of gruposVistos) {
      const valor = await siguienteValorSecuencia(tx, {
        lineaProductivaId: g.lineaProductivaId,
        fecha: g.fecha,
        tipo: g.puntoControlId,
      });
      nroMuestraAsignado.set(clave, valor);
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const input of inputs) {
      const registroId = crypto.randomUUID();
      const nroMuestra = nroMuestraAsignado.get(claveDe(input))!;
      const data = {
        puntoControlId: input.puntoControlId,
        loteId: input.loteId,
        lineaProductivaId: input.lineaProductivaId,
        responsableId: input.responsableId,
        turnoId: input.turnoId ?? null,
        fuenteOrigen: (input.fuenteOrigen as "tablet" | "api_externa" | "scada_opcua" | "scada_mqtt" | "importacion") ?? "tablet",
        fecha: new Date(input.fecha),
        hora: new Date(`1970-01-01T${input.hora}Z`),
        nroMuestra,
        filaProd: input.filaProd ?? null,
        notas: input.notas ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: dataConCorrelativoSincronizado(input.data, nroMuestra) as any,
      };

      ops.push(
        tx.registroCalidad.create({ data: { id: registroId, ...data } })
      );
      ops.push(
        tx.auditoriaRegistro.create({
          data: {
            registroCalidadId: registroId,
            accion: "crear",
            usuarioId: input.responsableId,
            datosDespues: data as object,
          },
        })
      );
    }

    return Promise.all(ops);
  });
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
