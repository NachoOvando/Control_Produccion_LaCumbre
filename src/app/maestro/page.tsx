import Link from "next/link";
import { auth } from "@/lib/auth";
import { ROLES_ADMIN_MAESTRO, tieneRol } from "@/lib/auth/roles";
import {
  getProductosMaestro,
  getMarcas,
  getFamilias,
  getParametros,
  getBindings,
  getTodasEspecificacionesVigentes,
} from "@/db/maestro.repository";
import { MaestroView } from "@/components/calidad/maestro/MaestroView";

export const dynamic = "force-dynamic";

// Prisma.Decimal no cruza la frontera Server→Client Component (es instancia de
// clase). Se aplana a number|null antes de pasar por props.
function dec(v: { toString(): string } | null): number | null {
  return v == null ? null : Number(v.toString());
}

export default async function MaestroPage() {
  const session = await auth();
  const esAdmin = tieneRol(session?.user?.rol as string | undefined, ROLES_ADMIN_MAESTRO);

  if (!esAdmin) {
    return (
      <div className="min-h-screen bg-[#f5f5f5]">
        <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            <Link href="/" className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-sm font-bold text-gray-900">Maestro de productos</h1>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 pt-8">
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="font-semibold text-gray-800">Acceso restringido</p>
            <p className="text-sm text-gray-500 mt-1">
              La administración del maestro está reservada al rol administrador — afecta la trazabilidad de exportación.
            </p>
            <Link href="/" className="inline-block mt-4 text-sm font-semibold text-[#E1000F] hover:underline">
              Volver al inicio
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const [productos, marcas, familias, parametros, bindings, specs] = await Promise.all([
    getProductosMaestro(),
    getMarcas(),
    getFamilias(),
    getParametros(),
    getBindings(),
    getTodasEspecificacionesVigentes(),
  ]);

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/" className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-sm font-bold text-gray-900">Maestro de productos</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pb-24 pt-4">
        <MaestroView
          productos={productos.map((p) => ({
            id: p.id,
            sku: p.sku,
            nombre: p.nombre,
            familiaId: p.familiaId,
            marcaId: p.marcaId,
            lineaProductivaId: p.lineaProductivaId,
            gusto: p.gusto,
            pesoGramos: dec(p.pesoGramos),
            unidadesPorCaja: dec(p.unidadesPorCaja),
            rendimientoTeorico: dec(p.rendimientoTeorico),
            unidadRendimiento: p.unidadRendimiento,
            cajasPorPallet: p.cajasPorPallet,
            vidaUtilMeses: p.vidaUtilMeses,
            pesoMasaCrudaG: dec(p.pesoMasaCrudaG),
            esSemielaborado: p.esSemielaborado,
            observaciones: p.observaciones,
            activo: p.activo,
            familiaNombre: p.familia.nombre,
            marcaNombre: p.marca.nombre,
          }))}
          marcas={marcas.map((m) => ({ id: m.id, nombre: m.nombre, lineaNegocio: m.lineaNegocio, activa: m.activa }))}
          familias={familias.map((f) => ({ id: f.id, slug: f.slug, nombre: f.nombre, activa: f.activa }))}
          parametros={parametros.map((p) => ({ id: p.id, clave: p.clave, nombre: p.nombre, unidad: p.unidad }))}
          bindings={bindings.map((b) => ({
            puntoControlId: b.puntoControlId,
            puntoControlNombre: b.puntoControl.nombre,
            parametroId: b.parametroId,
            parametroClave: b.parametro.clave,
            parametroNombre: b.parametro.nombre,
            unidad: b.parametro.unidad,
            agregacion: b.agregacion,
          }))}
          especificaciones={specs.map((e) => ({
            id: e.id,
            productoId: e.productoId,
            puntoControlId: e.puntoControlId,
            parametroId: e.parametroId,
            objetivo: dec(e.objetivo),
            aceptacionMin: dec(e.aceptacionMin),
            aceptacionMax: dec(e.aceptacionMax),
            criticoMin: dec(e.criticoMin),
            criticoMax: dec(e.criticoMax),
            esCritico: e.esCritico,
            version: e.version,
          }))}
        />
      </main>
    </div>
  );
}
