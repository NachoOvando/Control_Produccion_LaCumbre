import { getLineasConPuntosControl, getProductosActivos } from "@/db/calidad.repository";
import { CalidadModuloView } from "@/components/calidad/CalidadModuloView";
import Link from "next/link";

const DEMO_PRODUCTOS: { id: string; nombre: string; familia: { nombre: string }; marca: { nombre: string }; lineaProductivaId: string | null }[] = [
  { id: "demo-prod-1", nombre: "Alfajor Arcor Clásico", familia: { nombre: "Alfajor Negro" }, marca: { nombre: "ARCOR" }, lineaProductivaId: null },
  { id: "demo-prod-2", nombre: "Tapitas Negras 70mm", familia: { nombre: "Tapas" }, marca: { nombre: "GOAT" }, lineaProductivaId: null },
];

export const dynamic = "force-dynamic";

const LINEAS_DEMO = [
  {
    id: "demo-linea-1",
    nombre: "Línea 3",
    descripcion: "Conformado y bañado de alfajores",
    puntosControl: [
      // Dosificado
      {
        id: "demo-pc-1",
        nombre: "Control Peso Alfajor",
        descripcion: "12 mediciones de peso sin baño y con baño",
        orden: 1,
        seccion: "Dosificado",
        familias: [{ slug: "alfajor", nombre: "Alfajor" }],
      },
      {
        id: "demo-pc-2",
        nombre: "Control Peso Relleno",
        descripcion: "12 mediciones de peso de relleno",
        orden: 2,
        seccion: "Dosificado",
        familias: [{ slug: "alfajor", nombre: "Alfajor" }],
      },
      {
        id: "demo-pc-3",
        nombre: "Control Peso Baño",
        descripcion: "12 mediciones P1-P12 con T° baño y escurrimiento",
        orden: 3,
        seccion: "Dosificado",
        familias: [{ slug: "alfajor", nombre: "Alfajor" }, { slug: "tapitas", nombre: "Tapitas" }],
      },
      {
        id: "demo-pc-4",
        nombre: "Control Temperatura Tanques",
        descripcion: "DDL, Bon o Bon, Cobertura 1 y 2 — 3x por día",
        orden: 4,
        seccion: "Dosificado",
        familias: [],
      },
      // Salida del Túnel
      {
        id: "demo-pc-5",
        nombre: "Control Temperatura Condensación",
        descripcion: "Temperatura a la salida del túnel de enfriado",
        orden: 5,
        seccion: "Salida del Túnel",
        familias: [],
      },
      {
        id: "demo-pc-6",
        nombre: "Detector de Metales — PCC1",
        descripcion: "Verificación horaria — Punto Crítico de Control",
        orden: 6,
        seccion: "Salida del Túnel",
        familias: [],
      },
      {
        id: "demo-pc-8",
        nombre: "Producción Diaria",
        descripcion: "Pallets, cajas, lote PT y tiempo de túnel",
        orden: 7,
        seccion: "Salida del Túnel",
        familias: [],
      },
      // Trazabilidad Insumos
      {
        id: "demo-pc-10",
        nombre: "Trazabilidad Insumos",
        descripcion: "Lote en uso de tapas bañadas, Bonobon, DDL y baño",
        orden: 8,
        seccion: "Trazabilidad Insumos",
        familias: [],
      },
    ],
  },
  {
    id: "demo-linea-2",
    nombre: "Línea 1",
    descripcion: "Preparación y procesado de masa",
    puntosControl: [
      {
        id: "demo-pc-9",
        nombre: "Inspección Visual Masa",
        descripcion: "Control visual y de temperatura de masa",
        orden: 1,
        seccion: "",
        familias: [],
      },
    ],
  },
  {
    id: "demo-linea-3",
    nombre: "Línea 2",
    descripcion: "Envasado y etiquetado final",
    puntosControl: [],
  },
];

type SearchParams = { linea?: string };

export default async function PuntosControlPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { linea: lineaInicialId } = await searchParams;
  let lineasData: typeof LINEAS_DEMO = [];
  let productos: typeof DEMO_PRODUCTOS = [];

  try {
    const lineas = await getLineasConPuntosControl("calidad");
    // 0 líneas activas es un estado vacío legítimo (catálogo real sin datos),
    // no un disparador de datos demo — CalidadModuloView ya sabe renderizarlo.
    lineasData = lineas.map((l) => ({
      id: l.id,
      nombre: l.nombre.includes("—") ? l.nombre.split("—")[0].trim() : l.nombre,
      descripcion: l.descripcion ?? "",
      puntosControl: l.puntosControl.map((pcl) => ({
        id: pcl.puntoControl.id,
        nombre: pcl.puntoControl.nombre,
        descripcion: pcl.puntoControl.descripcion ?? "",
        orden: pcl.orden,
        seccion: (pcl.puntoControl as { seccion?: string }).seccion ?? "",
        // Familias persistidas en puntos_control_familias — label desde DB
        familias: pcl.puntoControl.familias.map((f) => ({
          slug: f.familia.slug,
          nombre: f.familia.nombre,
        })),
      })),
    }));
    const reales = await getProductosActivos();
    productos = reales.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      familia: { nombre: p.familia.nombre },
      marca: { nombre: p.marca.nombre },
      lineaProductivaId: p.lineaProductivaId,
    }));
  } catch (error) {
    console.error("[calidad] Fallo la carga de líneas/productos:", error);
    // Solo en modo demo explícito se cae a datos ficticios; en cualquier otro
    // caso (DB caída, timeout, bug de query) el error propaga al error
    // boundary (src/app/calidad/error.tsx) — nunca mostrar "Línea 3" ficticia
    // como si fuera real (integridad HACCP, mismo criterio que ADR-007).
    if (process.env.DEMO_MODE === "true") {
      lineasData = LINEAS_DEMO;
      productos = DEMO_PRODUCTOS;
    } else {
      throw error;
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E1000F] flex items-center justify-center">
              <span className="text-white font-bold text-lg">LC</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">La Cumbre</h1>
              <p className="text-xs text-gray-500">Control de Producción</p>
            </div>
          </Link>
          <div className="ml-2 flex items-center gap-1 text-gray-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <Link href="/calidad" className="text-sm font-semibold text-[#E1000F] hover:underline">
              Calidad
            </Link>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-semibold text-gray-700">Puntos de Control</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        <CalidadModuloView lineas={lineasData} productos={productos} lineaInicialId={lineaInicialId} />
      </main>
    </div>
  );
}
