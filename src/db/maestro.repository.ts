/**
 * Repository layer — Maestro de productos + especificaciones
 * Toda query del maestro pasa por aquí. Sin lógica de negocio (vive en el service).
 *
 * Auditoría: cada escritura sobre Producto/Marca/Familia/EspecificacionProducto
 * registra una fila append-only en auditoria_maestro DENTRO de la misma
 * transacción — mismo criterio HACCP que AuditoriaRegistro (ver ADR-015).
 *
 * Especificaciones: versionadas append-only. Editar NO pisa: cierra la versión
 * vigente (vigenteHasta = T) y abre una nueva (vigenteDesde = T) en la misma
 * transacción. El índice único parcial `especificaciones_producto_vigente_unica`
 * (WHERE vigente_hasta IS NULL, ver migración) es la red de seguridad dura.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

// Snapshot JSON-safe para auditoría: Prisma.Decimal.toJSON() devuelve string y
// Date.toJSON() ISO, así que el round-trip aplana ambos a tipos serializables
// que el campo Json acepta sin romper.
function snapshot(obj: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(obj)) as Prisma.InputJsonValue;
}

async function auditar(
  tx: Tx,
  params: {
    entidad: "producto" | "marca" | "familia" | "especificacion_producto";
    entidadId: string;
    accion: "crear" | "modificar" | "eliminar" | "restaurar";
    antes?: unknown;
    despues?: unknown;
    usuarioId: string;
  }
) {
  await tx.auditoriaMaestro.create({
    data: {
      entidad: params.entidad,
      entidadId: params.entidadId,
      accion: params.accion,
      snapshotAntes: params.antes != null ? snapshot(params.antes) : undefined,
      snapshotDespues: params.despues != null ? snapshot(params.despues) : undefined,
      usuarioId: params.usuarioId,
    },
  });
}

// -----------------------------------------------------------------------------
// Marcas
// -----------------------------------------------------------------------------

export async function getMarcas() {
  return prisma.marca.findMany({ orderBy: { nombre: "asc" } });
}

export async function crearMarca(
  data: { nombre: string; lineaNegocio: "marca_propia" | "copacker_arcor" | "fason_terceros" },
  usuarioId: string
) {
  return prisma.$transaction(async (tx) => {
    const marca = await tx.marca.create({ data });
    await auditar(tx, { entidad: "marca", entidadId: marca.id, accion: "crear", despues: marca, usuarioId });
    return marca;
  });
}

export async function actualizarMarca(
  id: string,
  data: { nombre?: string; lineaNegocio?: "marca_propia" | "copacker_arcor" | "fason_terceros"; activa?: boolean },
  usuarioId: string
) {
  return prisma.$transaction(async (tx) => {
    const antes = await tx.marca.findUnique({ where: { id } });
    if (!antes) return null;
    const marca = await tx.marca.update({ where: { id }, data });
    await auditar(tx, { entidad: "marca", entidadId: id, accion: "modificar", antes, despues: marca, usuarioId });
    return marca;
  });
}

// -----------------------------------------------------------------------------
// Familias
// -----------------------------------------------------------------------------

export async function getFamilias() {
  return prisma.familia.findMany({ orderBy: { nombre: "asc" } });
}

export async function crearFamilia(data: { slug: string; nombre: string }, usuarioId: string) {
  return prisma.$transaction(async (tx) => {
    const familia = await tx.familia.create({ data });
    await auditar(tx, { entidad: "familia", entidadId: familia.id, accion: "crear", despues: familia, usuarioId });
    return familia;
  });
}

export async function actualizarFamilia(
  id: string,
  data: { slug?: string; nombre?: string; activa?: boolean },
  usuarioId: string
) {
  return prisma.$transaction(async (tx) => {
    const antes = await tx.familia.findUnique({ where: { id } });
    if (!antes) return null;
    const familia = await tx.familia.update({ where: { id }, data });
    await auditar(tx, { entidad: "familia", entidadId: id, accion: "modificar", antes, despues: familia, usuarioId });
    return familia;
  });
}

// -----------------------------------------------------------------------------
// Productos
// -----------------------------------------------------------------------------

// Campos editables del producto — subconjunto del modelo que el CRUD admin toca.
// sku/nombre son claves operativas (ver ADR-010); se editan pero con cuidado en
// el service. lineaNegocio NO vive acá (es de Marca).
export type ProductoWriteData = {
  sku?: string | null;
  nombre: string;
  familiaId: string;
  marcaId: string;
  lineaProductivaId?: string | null;
  gusto?: string | null;
  pesoGramos?: number | null;
  unidadesPorCaja?: number | null;
  rendimientoTeorico?: number | null;
  unidadRendimiento?: "unidades_hora" | "cajas_amasijo" | null;
  cajasPorPallet?: number | null;
  vidaUtilMeses?: number | null;
  pesoMasaCrudaG?: number | null;
  esSemielaborado?: boolean;
  observaciones?: string | null;
  activo?: boolean;
};

// Listado completo (activos e inactivos) para la pantalla de administración.
export async function getProductosMaestro() {
  return prisma.producto.findMany({
    include: { familia: true, marca: true, lineaProductiva: true },
    orderBy: { nombre: "asc" },
  });
}

export async function getProductoPorId(id: string) {
  return prisma.producto.findUnique({
    where: { id },
    include: { familia: true, marca: true, lineaProductiva: true },
  });
}

export async function crearProducto(data: ProductoWriteData, usuarioId: string) {
  return prisma.$transaction(async (tx) => {
    const producto = await tx.producto.create({ data });
    await auditar(tx, { entidad: "producto", entidadId: producto.id, accion: "crear", despues: producto, usuarioId });
    return producto;
  });
}

export async function actualizarProducto(id: string, data: Partial<ProductoWriteData>, usuarioId: string) {
  return prisma.$transaction(async (tx) => {
    const antes = await tx.producto.findUnique({ where: { id } });
    if (!antes) return null;
    const producto = await tx.producto.update({ where: { id }, data });
    await auditar(tx, { entidad: "producto", entidadId: id, accion: "modificar", antes, despues: producto, usuarioId });
    return producto;
  });
}

// -----------------------------------------------------------------------------
// Parámetros y bindings (catálogo cerrado — solo lectura desde el CRUD; se
// siembran en el seed como estructura derivada de los schema_json)
// -----------------------------------------------------------------------------

export async function getParametros() {
  return prisma.parametro.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } });
}

// Bindings (punto de control × parámetro) — define qué parámetros son medibles
// en cada punto de control y cómo se agregan al comparar. La UI de specs los usa
// para ofrecer solo parámetros válidos por punto de control.
export async function getBindings() {
  return prisma.puntoControlParametro.findMany({
    include: { parametro: true, puntoControl: { select: { id: true, nombre: true, tipoFormulario: true } } },
  });
}

// -----------------------------------------------------------------------------
// Especificaciones por producto (versionadas, append-only)
// -----------------------------------------------------------------------------

// Todas las specs VIGENTES de un producto (vigenteHasta IS NULL).
export async function getEspecificacionesVigentesDeProducto(productoId: string) {
  return prisma.especificacionProducto.findMany({
    where: { productoId, vigenteHasta: null },
    include: { parametro: true, puntoControl: { select: { id: true, nombre: true, tipoFormulario: true } } },
    orderBy: [{ puntoControlId: "asc" }, { parametroId: "asc" }],
  });
}

// Specs vigentes de un producto para UN punto de control, con el binding
// (campoData/agregación) y la unidad del parámetro — todo lo que un formulario
// de captura necesita para comparar en vivo. Solo devuelve parámetros que tienen
// binding en ese punto de control (INNER join implícito por la relación).
export async function getEspecificacionesCaptura(productoId: string, puntoControlId: string) {
  const [specs, bindings] = await Promise.all([
    prisma.especificacionProducto.findMany({
      where: { productoId, puntoControlId, vigenteHasta: null },
      include: { parametro: true },
    }),
    prisma.puntoControlParametro.findMany({
      where: { puntoControlId },
      include: { parametro: true },
    }),
  ]);
  const bindingPorParametro = new Map(bindings.map((b) => [b.parametroId, b]));
  return specs
    .map((e) => {
      const binding = bindingPorParametro.get(e.parametroId);
      if (!binding) return null; // spec sin binding en este PC (no debería pasar)
      return { spec: e, binding };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// Todas las specs VIGENTES (de todos los productos) — para hidratar el módulo
// admin de una sola query. El módulo filtra por producto en el cliente.
export async function getTodasEspecificacionesVigentes() {
  return prisma.especificacionProducto.findMany({
    where: { vigenteHasta: null },
    orderBy: [{ productoId: "asc" }, { puntoControlId: "asc" }, { parametroId: "asc" }],
  });
}

// Historial completo de versiones de una spec lógica (para consulta/auditoría).
export async function getHistorialEspecificacion(params: {
  productoId: string;
  puntoControlId: string;
  parametroId: string;
}) {
  return prisma.especificacionProducto.findMany({
    where: params,
    orderBy: { version: "desc" },
  });
}

export type EspecificacionWriteData = {
  productoId: string;
  puntoControlId: string;
  parametroId: string;
  objetivo?: number | null;
  aceptacionMin?: number | null;
  aceptacionMax?: number | null;
  criticoMin?: number | null;
  criticoMax?: number | null;
  esCritico: boolean;
};

// Crea una versión nueva de la spec (o la primera). Cierra la vigente anterior y
// abre la nueva en la MISMA transacción y con el MISMO timestamp `T`:
// vigenteHasta(anterior) === vigenteDesde(nueva) → sin gaps ni solapes, la
// reconstrucción por ventana [vigenteDesde, vigenteHasta) es exacta. El índice
// parcial atrapa cualquier carrera que abra dos vigentes a la vez.
export async function versionarEspecificacion(data: EspecificacionWriteData, usuarioId: string) {
  const T = new Date();
  return prisma.$transaction(async (tx) => {
    const vigente = await tx.especificacionProducto.findFirst({
      where: {
        productoId: data.productoId,
        puntoControlId: data.puntoControlId,
        parametroId: data.parametroId,
        vigenteHasta: null,
      },
    });

    if (vigente) {
      await tx.especificacionProducto.update({
        where: { id: vigente.id },
        data: { vigenteHasta: T },
      });
    }

    const nueva = await tx.especificacionProducto.create({
      data: {
        productoId: data.productoId,
        puntoControlId: data.puntoControlId,
        parametroId: data.parametroId,
        objetivo: data.objetivo ?? null,
        aceptacionMin: data.aceptacionMin ?? null,
        aceptacionMax: data.aceptacionMax ?? null,
        criticoMin: data.criticoMin ?? null,
        criticoMax: data.criticoMax ?? null,
        esCritico: data.esCritico,
        version: vigente ? vigente.version + 1 : 1,
        vigenteDesde: T,
        vigenteHasta: null,
        creadoPorId: usuarioId,
      },
    });

    await auditar(tx, {
      entidad: "especificacion_producto",
      entidadId: nueva.id,
      accion: vigente ? "modificar" : "crear",
      antes: vigente ?? undefined,
      despues: nueva,
      usuarioId,
    });

    return nueva;
  });
}

// Cierra la spec vigente sin abrir una nueva (baja de la especificación). Deja
// el par (producto, punto de control, parámetro) sin spec vigente.
export async function cerrarEspecificacion(
  params: { productoId: string; puntoControlId: string; parametroId: string },
  usuarioId: string
) {
  const T = new Date();
  return prisma.$transaction(async (tx) => {
    const vigente = await tx.especificacionProducto.findFirst({
      where: { ...params, vigenteHasta: null },
    });
    if (!vigente) return null;
    const cerrada = await tx.especificacionProducto.update({
      where: { id: vigente.id },
      data: { vigenteHasta: T },
    });
    await auditar(tx, {
      entidad: "especificacion_producto",
      entidadId: vigente.id,
      accion: "eliminar",
      antes: vigente,
      despues: cerrada,
      usuarioId,
    });
    return cerrada;
  });
}

// Colisión contra el índice único parcial de "una sola vigente" — carrera de dos
// versionados concurrentes del mismo (producto, punto de control, parámetro).
export function esColisionEspecVigente(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const cols = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return cols.includes("especificaciones_producto_vigente_unica") || cols.includes("producto_id");
}
