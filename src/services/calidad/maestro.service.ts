/**
 * Service layer — Maestro de productos + especificaciones
 *
 * Valida payloads (Zod) y reglas de negocio antes de delegar la escritura al
 * repository. Sin lógica de negocio en el router; sin Prisma directo acá salvo
 * lecturas de verificación de existencia. Contrato de resultado discriminado por
 * `ok`, igual que lote.service.ts / linea-producto-activo.service.ts.
 *
 * Invariantes del maestro (ADR-010): `nombre` de producto es unique y es la
 * clave operativa; `sku` nullable+unique (no inventar SKU sintético); la línea
 * de negocio vive en Marca, no en Producto.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  crearProducto,
  actualizarProducto,
  crearMarca,
  actualizarMarca,
  crearFamilia,
  actualizarFamilia,
  versionarEspecificacion,
  esColisionEspecVigente,
  type ProductoWriteData,
  type EspecificacionWriteData,
} from "@/db/maestro.repository";

export type MaestroResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; details?: unknown };

function errValidacion(err: z.ZodError): MaestroResult<never> {
  return {
    ok: false,
    error: "Datos inválidos",
    code: "VALIDACION_ESTRUCTURA",
    details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

// P2002 (unique) → 409 con mensaje claro; cualquier otro error → ERROR_INTERNO.
function mapearErrorPrisma(err: unknown, contexto: string): MaestroResult<never> {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { ok: false, error: "Ya existe un registro con ese valor único (nombre/código/slug)", code: "DUPLICADO" };
  }
  console.error(`[maestro.service] ${contexto}:`, err);
  return { ok: false, error: "Error interno del maestro", code: "ERROR_INTERNO" };
}

// -----------------------------------------------------------------------------
// Marcas
// -----------------------------------------------------------------------------

const LineaNegocioEnum = z.enum(["marca_propia", "copacker_arcor", "fason_terceros"]);

const CrearMarcaSchema = z.object({
  nombre: z.string().trim().min(1, "nombre requerido").max(120),
  lineaNegocio: LineaNegocioEnum,
});

export async function crearMarcaService(rawInput: unknown, usuarioId: string): Promise<MaestroResult<unknown>> {
  const parsed = CrearMarcaSchema.safeParse(rawInput);
  if (!parsed.success) return errValidacion(parsed.error);
  try {
    return { ok: true, data: await crearMarca(parsed.data, usuarioId) };
  } catch (err) {
    return mapearErrorPrisma(err, "crearMarca");
  }
}

const ActualizarMarcaSchema = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  lineaNegocio: LineaNegocioEnum.optional(),
  activa: z.boolean().optional(),
});

export async function actualizarMarcaService(
  id: string,
  rawInput: unknown,
  usuarioId: string
): Promise<MaestroResult<unknown>> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "id inválido", code: "VALIDACION_ESTRUCTURA" };
  }
  const parsed = ActualizarMarcaSchema.safeParse(rawInput);
  if (!parsed.success) return errValidacion(parsed.error);
  try {
    const marca = await actualizarMarca(id, parsed.data, usuarioId);
    if (!marca) return { ok: false, error: "Marca no encontrada", code: "NO_ENCONTRADO" };
    return { ok: true, data: marca };
  } catch (err) {
    return mapearErrorPrisma(err, "actualizarMarca");
  }
}

// -----------------------------------------------------------------------------
// Familias
// -----------------------------------------------------------------------------

// slug: minúsculas, números y guión bajo (clave de UI y dispatch de forms).
const SlugSchema = z
  .string()
  .trim()
  .min(1, "slug requerido")
  .max(60)
  .regex(/^[a-z0-9_]+$/, "slug: solo minúsculas, números y guión bajo");

const CrearFamiliaSchema = z.object({
  slug: SlugSchema,
  nombre: z.string().trim().min(1, "nombre requerido").max(120),
});

export async function crearFamiliaService(rawInput: unknown, usuarioId: string): Promise<MaestroResult<unknown>> {
  const parsed = CrearFamiliaSchema.safeParse(rawInput);
  if (!parsed.success) return errValidacion(parsed.error);
  try {
    return { ok: true, data: await crearFamilia(parsed.data, usuarioId) };
  } catch (err) {
    return mapearErrorPrisma(err, "crearFamilia");
  }
}

const ActualizarFamiliaSchema = z.object({
  slug: SlugSchema.optional(),
  nombre: z.string().trim().min(1).max(120).optional(),
  activa: z.boolean().optional(),
});

export async function actualizarFamiliaService(
  id: string,
  rawInput: unknown,
  usuarioId: string
): Promise<MaestroResult<unknown>> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "id inválido", code: "VALIDACION_ESTRUCTURA" };
  }
  const parsed = ActualizarFamiliaSchema.safeParse(rawInput);
  if (!parsed.success) return errValidacion(parsed.error);
  try {
    const familia = await actualizarFamilia(id, parsed.data, usuarioId);
    if (!familia) return { ok: false, error: "Familia no encontrada", code: "NO_ENCONTRADO" };
    return { ok: true, data: familia };
  } catch (err) {
    return mapearErrorPrisma(err, "actualizarFamilia");
  }
}

// -----------------------------------------------------------------------------
// Productos
// -----------------------------------------------------------------------------

// Campos numéricos del maestro: no negativos; nullable (muchos productos no los
// tienen cargados). `sku` nullable — no se inventa código.
const numeroNoNegativoOpc = z.number().nonnegative().nullable().optional();

const ProductoBaseSchema = z.object({
  sku: z.string().trim().min(1).max(60).nullable().optional(),
  nombre: z.string().trim().min(1, "nombre requerido").max(300),
  familiaId: z.string().uuid("familiaId debe ser UUID"),
  marcaId: z.string().uuid("marcaId debe ser UUID"),
  lineaProductivaId: z.string().uuid().nullable().optional(),
  gusto: z.string().trim().max(120).nullable().optional(),
  pesoGramos: numeroNoNegativoOpc,
  unidadesPorCaja: numeroNoNegativoOpc,
  rendimientoTeorico: numeroNoNegativoOpc,
  unidadRendimiento: z.enum(["unidades_hora", "cajas_amasijo"]).nullable().optional(),
  cajasPorPallet: z.number().int().nonnegative().nullable().optional(),
  vidaUtilMeses: z.number().int().positive().nullable().optional(),
  pesoMasaCrudaG: numeroNoNegativoOpc,
  esSemielaborado: z.boolean().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
  activo: z.boolean().optional(),
});

// Verifica que familia/marca/línea referenciadas existan (FK amigable antes de
// que Prisma tire P2003 crudo).
async function verificarRefsProducto(data: {
  familiaId: string;
  marcaId: string;
  lineaProductivaId?: string | null;
}): Promise<MaestroResult<never> | null> {
  const [familia, marca] = await Promise.all([
    prisma.familia.findUnique({ where: { id: data.familiaId }, select: { id: true } }),
    prisma.marca.findUnique({ where: { id: data.marcaId }, select: { id: true } }),
  ]);
  if (!familia) return { ok: false, error: "Familia no encontrada", code: "FAMILIA_NO_ENCONTRADA" };
  if (!marca) return { ok: false, error: "Marca no encontrada", code: "MARCA_NO_ENCONTRADA" };
  if (data.lineaProductivaId) {
    const linea = await prisma.lineaProductiva.findUnique({
      where: { id: data.lineaProductivaId },
      select: { id: true },
    });
    if (!linea) return { ok: false, error: "Línea productiva no encontrada", code: "LINEA_NO_ENCONTRADA" };
  }
  return null;
}

export async function crearProductoService(rawInput: unknown, usuarioId: string): Promise<MaestroResult<unknown>> {
  const parsed = ProductoBaseSchema.safeParse(rawInput);
  if (!parsed.success) return errValidacion(parsed.error);
  const refErr = await verificarRefsProducto(parsed.data);
  if (refErr) return refErr;
  try {
    return { ok: true, data: await crearProducto(parsed.data as ProductoWriteData, usuarioId) };
  } catch (err) {
    return mapearErrorPrisma(err, "crearProducto");
  }
}

const ActualizarProductoSchema = ProductoBaseSchema.partial();

export async function actualizarProductoService(
  id: string,
  rawInput: unknown,
  usuarioId: string
): Promise<MaestroResult<unknown>> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "id inválido", code: "VALIDACION_ESTRUCTURA" };
  }
  const parsed = ActualizarProductoSchema.safeParse(rawInput);
  if (!parsed.success) return errValidacion(parsed.error);
  // Solo verificar refs que vengan en el payload
  if (parsed.data.familiaId || parsed.data.marcaId || parsed.data.lineaProductivaId) {
    const existente = await prisma.producto.findUnique({
      where: { id },
      select: { familiaId: true, marcaId: true },
    });
    if (!existente) return { ok: false, error: "Producto no encontrado", code: "NO_ENCONTRADO" };
    const refErr = await verificarRefsProducto({
      familiaId: parsed.data.familiaId ?? existente.familiaId,
      marcaId: parsed.data.marcaId ?? existente.marcaId,
      lineaProductivaId: parsed.data.lineaProductivaId,
    });
    if (refErr) return refErr;
  }
  try {
    const producto = await actualizarProducto(id, parsed.data as Partial<ProductoWriteData>, usuarioId);
    if (!producto) return { ok: false, error: "Producto no encontrado", code: "NO_ENCONTRADO" };
    return { ok: true, data: producto };
  } catch (err) {
    return mapearErrorPrisma(err, "actualizarProducto");
  }
}

// -----------------------------------------------------------------------------
// Especificaciones por producto (versionadas)
// -----------------------------------------------------------------------------

const EspecificacionSchema = z
  .object({
    productoId: z.string().uuid("productoId debe ser UUID"),
    puntoControlId: z.string().uuid("puntoControlId debe ser UUID"),
    parametroId: z.string().uuid("parametroId debe ser UUID"),
    objetivo: z.number().nullable().optional(),
    aceptacionMin: z.number().nullable().optional(),
    aceptacionMax: z.number().nullable().optional(),
    criticoMin: z.number().nullable().optional(),
    criticoMax: z.number().nullable().optional(),
    esCritico: z.boolean().default(false),
  })
  .superRefine((d, ctx) => {
    // Al menos un límite u objetivo; una spec vacía no tiene sentido.
    const algunLimite =
      d.objetivo != null ||
      d.aceptacionMin != null ||
      d.aceptacionMax != null ||
      d.criticoMin != null ||
      d.criticoMax != null;
    if (!algunLimite) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Cargá al menos un objetivo o un límite" });
    }
    // Ordenamiento anidado (donde ambos extremos existan): min <= max.
    if (d.aceptacionMin != null && d.aceptacionMax != null && d.aceptacionMin > d.aceptacionMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "aceptacionMin no puede ser mayor que aceptacionMax", path: ["aceptacionMin"] });
    }
    if (d.criticoMin != null && d.criticoMax != null && d.criticoMin > d.criticoMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "criticoMin no puede ser mayor que criticoMax", path: ["criticoMin"] });
    }
    // El crítico es el envolvente externo: aceptación queda dentro del crítico.
    if (d.criticoMin != null && d.aceptacionMin != null && d.aceptacionMin < d.criticoMin) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "aceptacionMin no puede ser menor que criticoMin", path: ["aceptacionMin"] });
    }
    if (d.criticoMax != null && d.aceptacionMax != null && d.aceptacionMax > d.criticoMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "aceptacionMax no puede ser mayor que criticoMax", path: ["aceptacionMax"] });
    }
    // Objetivo dentro del rango de aceptación (si está definido).
    if (d.objetivo != null) {
      if (d.aceptacionMin != null && d.objetivo < d.aceptacionMin) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "objetivo por debajo de aceptacionMin", path: ["objetivo"] });
      }
      if (d.aceptacionMax != null && d.objetivo > d.aceptacionMax) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "objetivo por encima de aceptacionMax", path: ["objetivo"] });
      }
    }
  });

export async function guardarEspecificacionService(
  rawInput: unknown,
  usuarioId: string
): Promise<MaestroResult<unknown>> {
  const parsed = EspecificacionSchema.safeParse(rawInput);
  if (!parsed.success) return errValidacion(parsed.error);

  // El binding (punto de control × parámetro) debe existir: una spec solo puede
  // existir para un parámetro efectivamente medible en ese punto de control.
  const [producto, binding] = await Promise.all([
    prisma.producto.findUnique({ where: { id: parsed.data.productoId }, select: { id: true } }),
    prisma.puntoControlParametro.findUnique({
      where: {
        puntoControlId_parametroId: {
          puntoControlId: parsed.data.puntoControlId,
          parametroId: parsed.data.parametroId,
        },
      },
      select: { agregacion: true },
    }),
  ]);
  if (!producto) return { ok: false, error: "Producto no encontrado", code: "PRODUCTO_NO_ENCONTRADO" };
  if (!binding) {
    return {
      ok: false,
      error: "Ese parámetro no está habilitado para ese punto de control",
      code: "BINDING_INEXISTENTE",
    };
  }

  try {
    const spec = await versionarEspecificacion(parsed.data as EspecificacionWriteData, usuarioId);
    return { ok: true, data: spec };
  } catch (err) {
    if (esColisionEspecVigente(err)) {
      // Dos versionados concurrentes de la misma spec — carrera benigna: el otro
      // request ya abrió la versión vigente. El cliente puede reintentar/refrescar.
      return { ok: false, error: "La especificación fue modificada en paralelo, reintentá", code: "CONFLICTO_CONCURRENCIA" };
    }
    return mapearErrorPrisma(err, "guardarEspecificacion");
  }
}
