/**
 * Import one-shot del maestro de productos (Excel, hoja "BD").
 *
 * Uso:
 *   npx tsx scripts/import-maestro-productos.ts [ruta-al-xlsx]
 *   (default: C:\Users\Usuario\Desktop\Productos.xlsx)
 *
 * Idempotente: upsert por `nombre` (descripción std completa) — correrlo dos veces
 * no duplica productos, familias ni marcas.
 *
 * Estructura esperada de "Descripción Nueva (Std)":
 *   Familia; Gusto; Marca; Peso en gramos; unidades por caja
 */
import { PrismaClient, LineaNegocio, UnidadRendimiento, ModuloApp } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as dotenvConfig } from "dotenv";
import * as XLSX from "xlsx";
import path from "path";

// Next.js carga .env.local automáticamente; fuera de Next hay que hacerlo a mano
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL no está definida en el entorno");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Línea de negocio por marca — asignación confirmada por el usuario (2026-07-07).
const LINEA_NEGOCIO_POR_MARCA: Record<string, LineaNegocio> = {
  ARCOR: LineaNegocio.copacker_arcor,
  GOAT: LineaNegocio.copacker_arcor,
  LC: LineaNegocio.marca_propia,
};
const LINEA_NEGOCIO_DEFAULT = LineaNegocio.fason_terceros;

// SKUs que aparecen duplicados en el maestro origen: ninguna fila los conserva.
const SKUS_DUPLICADOS = new Set(["MADA200C12(B)"]);

type FilaMaestro = {
  descripcionVieja: string;
  codigo: string;
  lineaProductiva: number | null;
  descripcionStd: string;
  rendimientoTeorico: number | null;
  um: string;
  cajasPorPallet: number | null;
  vidaUtil: number | null;
  pesoMasaCruda: number | null;
  obs: string;
};

function slugify(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // sin tildes
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// "13,3" → 13.3 · "NA"/"" → null
function numeroONull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const s = String(valor).trim();
  if (s.toUpperCase() === "NA") return null;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function mapearUM(um: string): UnidadRendimiento | null {
  const s = um.trim().toLowerCase();
  if (s === "unidades/hr") return UnidadRendimiento.unidades_hora;
  if (s === "caja/amasijo") return UnidadRendimiento.cajas_amasijo;
  return null;
}

function leerMaestro(rutaXlsx: string): FilaMaestro[] {
  const wb = XLSX.readFile(rutaXlsx);
  const ws = wb.Sheets["BD"];
  if (!ws) throw new Error(`La hoja "BD" no existe en ${rutaXlsx}`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  return rows
    .slice(1) // saltar encabezado
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => ({
      descripcionVieja: String(r[0] ?? "").trim(),
      codigo: String(r[1] ?? "").trim(),
      lineaProductiva: numeroONull(r[2]),
      descripcionStd: String(r[3] ?? "").trim(),
      rendimientoTeorico: numeroONull(r[4]),
      um: String(r[5] ?? "").trim(),
      cajasPorPallet: numeroONull(r[6]) !== null ? Math.round(numeroONull(r[6])!) : null,
      vidaUtil: numeroONull(r[7]) !== null ? Math.round(numeroONull(r[7])!) : null,
      pesoMasaCruda: numeroONull(r[8]),
      obs: String(r[9] ?? "").trim(),
    }));
}

async function main() {
  // "C:\\" con barra: path.join("C:", ...) produce una ruta drive-relative que
  // Node resuelve contra el cwd — no contra la raíz del disco.
  const rutaXlsx = process.argv[2] ?? path.join("C:\\", "Users", "Usuario", "Desktop", "Productos.xlsx");
  console.log(`📄 Leyendo maestro: ${rutaXlsx}`);

  const filas = leerMaestro(rutaXlsx);
  console.log(`   ${filas.length} filas de datos\n`);

  const warnings: string[] = [];

  // ── Líneas productivas 0-3 ───────────────────────────────────────────────
  // 0/1/2 se crean nuevas; la 3 es la existente "Línea 3".
  const lineasPorCodigo = new Map<number, string>();
  for (const codigo of [0, 1, 2]) {
    const nombre = `Línea ${codigo}`;
    const linea = await prisma.lineaProductiva.upsert({
      where: { nombre },
      update: { codigo },
      create: { nombre, codigo, modulo: ModuloApp.calidad, descripcion: `Línea productiva ${codigo} (maestro de productos)` },
    });
    lineasPorCodigo.set(codigo, linea.id);
  }
  const linea3 = await prisma.lineaProductiva.findUnique({ where: { nombre: "Línea 3" } });
  if (linea3) {
    await prisma.lineaProductiva.update({ where: { id: linea3.id }, data: { codigo: 3 } });
    lineasPorCodigo.set(3, linea3.id);
  } else {
    warnings.push('No existe "Línea 3" — correr el seed primero. Productos de línea 3 quedan sin línea.');
  }

  // ── Recorrer filas: familias, marcas, productos ──────────────────────────
  const familiasCache = new Map<string, string>(); // nombre → id
  const marcasCache = new Map<string, string>();
  let creados = 0;
  let actualizados = 0;

  for (const [i, fila] of filas.entries()) {
    const nroFila = i + 2; // 1-based + encabezado

    const partes = fila.descripcionStd.split(";").map((s) => s.trim());
    if (partes.length !== 5) {
      warnings.push(`Fila ${nroFila}: descripción std no tiene 5 partes ("${fila.descripcionStd}") — SALTEADA`);
      continue;
    }
    const [familiaNombre, gusto, marcaNombre, pesoStr, unidStr] = partes;

    // Familia
    let familiaId = familiasCache.get(familiaNombre);
    if (!familiaId) {
      const familia = await prisma.familia.upsert({
        where: { nombre: familiaNombre },
        update: {},
        create: { nombre: familiaNombre, slug: slugify(familiaNombre) },
      });
      familiaId = familia.id;
      familiasCache.set(familiaNombre, familiaId);
    }

    // Marca
    let marcaId = marcasCache.get(marcaNombre);
    if (!marcaId) {
      const lineaNegocio = LINEA_NEGOCIO_POR_MARCA[marcaNombre] ?? LINEA_NEGOCIO_DEFAULT;
      const marca = await prisma.marca.upsert({
        where: { nombre: marcaNombre },
        update: {},
        create: { nombre: marcaNombre, lineaNegocio },
      });
      marcaId = marca.id;
      marcasCache.set(marcaNombre, marcaId);
    }

    // SKU: null si está vacío o si es un duplicado conocido del maestro origen
    let sku: string | null = fila.codigo || null;
    let observaciones = fila.obs || null;
    if (sku && SKUS_DUPLICADOS.has(sku)) {
      observaciones = [observaciones, `SKU duplicado en maestro origen (${sku}) — definir código correcto`]
        .filter(Boolean)
        .join(" · ");
      sku = null;
    }

    const esSemielaborado = /semi[\s-]*elaborado/i.test(fila.obs);
    let lineaProductivaId: string | null = null;
    if (fila.lineaProductiva !== null) {
      lineaProductivaId = lineasPorCodigo.get(fila.lineaProductiva) ?? null;
      if (!lineaProductivaId) {
        warnings.push(`Fila ${nroFila}: código de línea ${fila.lineaProductiva} desconocido — producto queda sin línea`);
      }
    }

    const data = {
      sku,
      familiaId,
      marcaId,
      lineaProductivaId,
      gusto: gusto || null,
      pesoGramos: numeroONull(pesoStr),
      unidadesPorCaja: numeroONull(unidStr),
      rendimientoTeorico: fila.rendimientoTeorico,
      unidadRendimiento: mapearUM(fila.um),
      cajasPorPallet: fila.cajasPorPallet,
      vidaUtilMeses: fila.vidaUtil,
      pesoMasaCrudaG: fila.pesoMasaCruda,
      esSemielaborado,
      observaciones,
      descripcionVieja: fila.descripcionVieja || null,
    };

    try {
      const existente = await prisma.producto.findUnique({ where: { nombre: fila.descripcionStd } });
      await prisma.producto.upsert({
        where: { nombre: fila.descripcionStd },
        update: data,
        create: { nombre: fila.descripcionStd, ...data },
      });
      if (existente) actualizados++;
      else creados++;
    } catch (e) {
      // Una fila con conflicto (ej. SKU duplicado no conocido) no aborta el import completo
      warnings.push(`Fila ${nroFila}: error al guardar "${fila.descripcionStd}" — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  }

  // ── Resumen ──────────────────────────────────────────────────────────────
  const [nFamilias, nMarcas, nProductos] = await Promise.all([
    prisma.familia.count(),
    prisma.marca.count(),
    prisma.producto.count(),
  ]);
  console.log("✅ Import completado");
  console.log(`   Productos: ${creados} creados, ${actualizados} actualizados (total en DB: ${nProductos})`);
  console.log(`   Familias en DB: ${nFamilias} · Marcas en DB: ${nMarcas}`);
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warnings:`);
    warnings.forEach((w) => console.log(`   - ${w}`));
  }
}

main()
  .catch((e) => {
    console.error("❌ Import falló:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
