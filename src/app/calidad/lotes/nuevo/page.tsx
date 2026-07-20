import Link from "next/link";
import { auth } from "@/lib/auth";
import { getProductosActivos } from "@/db/calidad.repository";
import { AltaLoteForm } from "@/components/calidad/AltaLoteForm";
import { ROLES_SUPERVISION_CALIDAD, tieneRol } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

// Productos demo — mismo criterio de fallback que el resto del módulo cuando no hay DB.
const DEMO_PRODUCTOS = [
  { id: "demo-prod-1", nombre: "Alfajor Arcor Clásico", familia: { nombre: "Alfajor Negro" }, marca: { nombre: "ARCOR" } },
  { id: "demo-prod-2", nombre: "Tapitas Negras 70mm", familia: { nombre: "Tapas" }, marca: { nombre: "GOAT" } },
];

export default async function AltaLotePage() {
  const session = await auth();
  const rolPermitido = tieneRol(session?.user?.rol as string | undefined, ROLES_SUPERVISION_CALIDAD);

  let productos: typeof DEMO_PRODUCTOS = [];
  try {
    const reales = await getProductosActivos();
    productos = reales.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      familia: { nombre: p.familia.nombre },
      marca: { nombre: p.marca.nombre },
    }));
  } catch (error) {
    console.error("[calidad] Fallo la carga de productos activos:", error);
    // Solo en modo demo explícito se cae a datos ficticios; en cualquier otro
    // caso el error propaga al error boundary — un supervisor no debe poder
    // dar de alta un lote contra productos demo sin saber que la DB está caída
    // (mismo criterio de C1, ver ADR-007).
    if (process.env.DEMO_MODE === "true") {
      productos = DEMO_PRODUCTOS;
    } else {
      throw error;
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/calidad/puntos-control" className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-sm font-bold text-gray-900">Dar de alta un lote</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-32 pt-4">
        {rolPermitido ? (
          <AltaLoteForm productos={productos} />
        ) : (
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="font-semibold text-gray-800">No tenés permiso para dar de alta un lote</p>
            <p className="text-sm text-gray-500 mt-1">
              Esta acción está restringida a supervisores de calidad, jefes de planta y administradores.
            </p>
            <Link
              href="/calidad/puntos-control"
              className="inline-block mt-4 text-sm font-semibold text-[#E1000F] hover:underline"
            >
              Volver a Puntos de Control
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
