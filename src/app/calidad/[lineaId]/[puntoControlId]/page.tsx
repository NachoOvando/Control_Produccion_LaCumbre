import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { DefectosConformadoForm } from "@/components/calidad/DefectosConformadoForm";
import { PesoMedicionesForm, type TipoFormularioPeso } from "@/components/calidad/PesoMedicionesForm";
import { TemperaturaForm, type TipoFormularioTemp } from "@/components/calidad/TemperaturaForm";
import { DetectorMetalesForm } from "@/components/calidad/DetectorMetalesForm";
import { ProduccionDiariaForm } from "@/components/calidad/ProduccionDiariaForm";
import { TrazabilidadInsumosForm } from "@/components/calidad/TrazabilidadInsumosForm";
import { RoturaEncajadoForm } from "@/components/calidad/RoturaEncajadoForm";
import { PesoOppForm } from "@/components/calidad/PesoOppForm";
import { RegistroGenericoForm } from "@/components/calidad/RegistroGenericoForm";
import { getRelacionPuntoLinea, getProductoActivoDeLinea } from "@/db/calidad.repository";
import { getEspecificacionesCaptura } from "@/db/maestro.repository";
import { jornadaProductiva } from "@/lib/calidad/fecha-planta";
import type { ProductoActivoLinea, EspecCampo } from "@/types/calidad";

function dec(v: { toString(): string } | null): number | null {
  return v == null ? null : Number(v.toString());
}

const TIPOS_PESO = new Set<string>(["peso_alfajor", "peso_relleno", "peso_bano"]);
const TIPOS_TEMPERATURA = new Set<string>(["temperatura_condensacion", "temperatura_tanques"]);

export const dynamic = "force-dynamic";

type Params = {
  lineaId: string;
  puntoControlId: string;
};

// Datos demo para preview sin DB
const LINEA_3 = { id: "demo-linea-1", nombre: "Línea 3" };

// `activo` espeja el gate de rollout de la DB real (ver
// docs/modulo-calidad.md): los tres de peso de dosificado están deshabilitados,
// así el modo demo ejercita también el guard de esta misma página.
const DEMO_RELACIONES: Record<string, {
  puntoControl: { id: string; nombre: string; descripcion: string | null; tipoFormulario: string; schemaJson: object; activo: boolean };
  lineaProductiva: { id: string; nombre: string };
}> = {
  // Línea 3 — Dosificado
  "demo-pc-1": {
    puntoControl: { id: "demo-pc-1", nombre: "Control Peso Alfajor", descripcion: "12 mediciones de peso sin baño y con baño", tipoFormulario: "peso_alfajor", schemaJson: {}, activo: false },
    lineaProductiva: LINEA_3,
  },
  "demo-pc-2": {
    puntoControl: { id: "demo-pc-2", nombre: "Control Peso Relleno", descripcion: "12 mediciones de peso de relleno", tipoFormulario: "peso_relleno", schemaJson: {}, activo: false },
    lineaProductiva: LINEA_3,
  },
  "demo-pc-3": {
    puntoControl: { id: "demo-pc-3", nombre: "Control Peso Baño", descripcion: "12 mediciones P1-P12 con T° baño y escurrimiento", tipoFormulario: "peso_bano", schemaJson: {}, activo: false },
    lineaProductiva: LINEA_3,
  },
  "demo-pc-4": {
    puntoControl: { id: "demo-pc-4", nombre: "Control Temperatura Tanques", descripcion: "DDL, Bon o Bon, Cobertura 1 y 2 — 3x por día", tipoFormulario: "temperatura_tanques", schemaJson: {}, activo: true },
    lineaProductiva: LINEA_3,
  },
  // Línea 3 — Salida del Túnel
  "demo-pc-5": {
    puntoControl: { id: "demo-pc-5", nombre: "Control Temperatura Condensación", descripcion: "Temperatura a la salida del túnel de enfriado", tipoFormulario: "temperatura_condensacion", schemaJson: {}, activo: true },
    lineaProductiva: LINEA_3,
  },
  "demo-pc-6": {
    puntoControl: { id: "demo-pc-6", nombre: "Detector de Metales — PCC1", descripcion: "Verificación horaria de patrones y rechazos", tipoFormulario: "detector_metales", schemaJson: {}, activo: true },
    lineaProductiva: LINEA_3,
  },
  "demo-pc-8": {
    puntoControl: { id: "demo-pc-8", nombre: "Producción Diaria", descripcion: "Pallets, cajas, lote PT y tiempo de túnel", tipoFormulario: "produccion_diaria", schemaJson: {}, activo: true },
    lineaProductiva: LINEA_3,
  },
  "demo-pc-10": {
    puntoControl: { id: "demo-pc-10", nombre: "Trazabilidad Insumos", descripcion: "Lote en uso de cada insumo — un registro por cambio de lote", tipoFormulario: "trazabilidad_insumos", schemaJson: {}, activo: true },
    lineaProductiva: LINEA_3,
  },
  // Línea 1
  "demo-pc-9": {
    puntoControl: { id: "demo-pc-9", nombre: "Inspección Visual Masa", descripcion: "Control visual y de temperatura de masa", tipoFormulario: "inspeccion_visual", schemaJson: {}, activo: true },
    lineaProductiva: { id: "demo-linea-2", nombre: "Línea 1" },
  },
};

const DEMO_PRODUCTO_ACTIVO: ProductoActivoLinea = {
  loteId: "demo-lote-1",
  numeroLote: "LC-2024-001",
  productoId: "demo-prod-1",
  productoNombre: "Alfajor Arcor Clásico",
  familiaSlug: "alfajor",
  vidaUtilMeses: 9,
  nomenclaturaLote: "L{yyyyMMdd}-{correlativo}",
  cajasPorPallet: 48,
  unidadesPorCaja: 21,
  activadoPorNombre: "Demo",
  activadoEn: new Date(0).toISOString(),
};

export default async function RegistroPuntoControlPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { lineaId, puntoControlId } = await params;

  let relacion: {
    puntoControl: { id: string; nombre: string; descripcion: string | null; tipoFormulario: string; schemaJson: unknown; activo: boolean };
    lineaProductiva: { id: string; nombre: string };
  } | null = null;

  let productoActivo: ProductoActivoLinea | null = null;

  try {
    const rel = await getRelacionPuntoLinea(puntoControlId, lineaId);
    if (rel) {
      relacion = {
        puntoControl: { ...rel.puntoControl, tipoFormulario: rel.puntoControl.tipoFormulario },
        lineaProductiva: rel.lineaProductiva,
      };

      // jornadaProductiva() (no hoyPlanta()): mismo criterio que el GET de
      // producto-activo — evita que esta página diga "sin producto activo"
      // en la franja 00:00-05:59 cuando en realidad sí lo hay (ADR-013).
      const estado = await getProductoActivoDeLinea(lineaId, jornadaProductiva());
      if (estado) {
        productoActivo = {
          loteId: estado.loteActivo.id,
          numeroLote: estado.loteActivo.numeroLote,
          productoId: estado.loteActivo.producto.id,
          productoNombre: estado.loteActivo.producto.nombre,
          familiaSlug: estado.loteActivo.producto.familia.slug,
          vidaUtilMeses: estado.loteActivo.producto.vidaUtilMeses,
          nomenclaturaLote: estado.loteActivo.producto.nomenclaturaLote,
          cajasPorPallet: estado.loteActivo.producto.cajasPorPallet,
          unidadesPorCaja: dec(estado.loteActivo.producto.unidadesPorCaja),
          activadoPorNombre: estado.activadoPor.nombre,
          activadoEn: estado.activadoEn.toISOString(),
        };

        // Specs vigentes del producto para este punto de control — habilitan la
        // comparación en vivo en el formulario (ADR-015). Falla suave: si algo
        // sale mal, el form simplemente no muestra rangos, no rompe la captura.
        try {
          const filas = await getEspecificacionesCaptura(estado.loteActivo.producto.id, puntoControlId);
          productoActivo.especificaciones = filas.map<EspecCampo>(({ spec, binding }) => ({
            campoData: binding.campoData,
            agregacion: binding.agregacion,
            parametroNombre: binding.parametro.nombre,
            unidad: binding.parametro.unidad,
            objetivo: dec(spec.objetivo),
            aceptacionMin: dec(spec.aceptacionMin),
            aceptacionMax: dec(spec.aceptacionMax),
            criticoMin: dec(spec.criticoMin),
            criticoMax: dec(spec.criticoMax),
            esCritico: spec.esCritico,
          }));
        } catch (specErr) {
          console.error("[calidad] No se pudieron cargar las especificaciones:", specErr);
        }
      }
    }
  } catch (error) {
    console.error("[calidad] Fallo la carga de punto de control/producto activo:", { lineaId, puntoControlId, error });
    // Mismo criterio que C1/C2 (ADR-007): el fallback demo solo existe gateado
    // por DEMO_MODE explícito. Sin DEMO_MODE, o si el puntoControlId no matchea
    // ninguna relación demo, el error propaga — nunca renderizar un punto de
    // control real sin producto activo resuelto (un registro HACCP apuntando
    // a un lote inexistente es peor que un error visible).
    if (process.env.DEMO_MODE === "true" && DEMO_RELACIONES[puntoControlId]) {
      relacion = DEMO_RELACIONES[puntoControlId];
      productoActivo = DEMO_PRODUCTO_ACTIVO;
    } else {
      throw error;
    }
  }

  if (!relacion) notFound();

  // Gate de rollout: el punto de control existe y está asignado a la línea, pero
  // todavía no está habilitado. Se vuelve al listado (no `notFound()`): ahí el
  // operario ve la MISMA tarjeta que quiso abrir, en gris y con su badge — es la
  // explicación más clara posible, y `notFound()` caería en el 404 default de
  // Next, sin link de vuelta y sin distinguirse de un id mal tipeado.
  //
  // IMPORTANTE: este bloque va FUERA del try/catch de arriba. `redirect()`
  // señaliza lanzando un error con digest NEXT_REDIRECT; adentro del catch,
  // con DEMO_MODE=true y una relación demo válida, se lo comería y renderizaría
  // el formulario igual.
  if (!relacion.puntoControl.activo) redirect(`/calidad/puntos-control?linea=${lineaId}`);

  // No se puede entrar a un punto de control sin producto activo definido —
  // volver al selector de línea para que el operario lo elija primero.
  if (!productoActivo) redirect(`/calidad/puntos-control?linea=${lineaId}`);

  const pc = relacion.puntoControl;
  const linea = relacion.lineaProductiva;
  // La familia ya no viaja por query param — se deriva del producto activo,
  // única fuente de verdad (se usa para el dispatch por familia de PesoMediciones).
  const familia = productoActivo.familiaSlug;

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href={`/calidad/puntos-control?linea=${lineaId}`}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 truncate">{linea.nombre}</p>
            <h1 className="text-sm font-bold text-gray-900 leading-tight truncate">{pc.nombre}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-32 pt-4">
        {pc.tipoFormulario === "defectos_conformado" ? (
          <DefectosConformadoForm
            puntoControlId={pc.id}
            lineaProductivaId={lineaId}
            productoActivo={productoActivo}
          />
        ) : TIPOS_PESO.has(pc.tipoFormulario) ? (
          <PesoMedicionesForm
            puntoControlId={pc.id}
            lineaProductivaId={lineaId}
            tipoFormulario={pc.tipoFormulario as TipoFormularioPeso}
            productoActivo={productoActivo}
            familia={familia}
          />
        ) : TIPOS_TEMPERATURA.has(pc.tipoFormulario) ? (
          <TemperaturaForm
            puntoControlId={pc.id}
            lineaProductivaId={lineaId}
            tipoFormulario={pc.tipoFormulario as TipoFormularioTemp}
            productoActivo={productoActivo}
          />
        ) : pc.tipoFormulario === "detector_metales" ? (
          <DetectorMetalesForm
            puntoControlId={pc.id}
            lineaProductivaId={lineaId}
            productoActivo={productoActivo}
          />
        ) : pc.tipoFormulario === "trazabilidad_insumos" ? (
          <TrazabilidadInsumosForm
            puntoControlId={pc.id}
            lineaProductivaId={lineaId}
            productoActivo={productoActivo}
          />
        ) : pc.tipoFormulario === "rotura_encajado" ? (
          <RoturaEncajadoForm
            puntoControlId={pc.id}
            lineaProductivaId={lineaId}
            productoActivo={productoActivo}
          />
        ) : pc.tipoFormulario === "peso_paquete_opp" ? (
          <PesoOppForm
            puntoControlId={pc.id}
            lineaProductivaId={lineaId}
            productoActivo={productoActivo}
          />
        ) : pc.tipoFormulario === "produccion_diaria" ? (
          <ProduccionDiariaForm
            puntoControlId={pc.id}
            lineaProductivaId={lineaId}
            productoActivo={productoActivo}
          />
        ) : (
          <RegistroGenericoForm
            puntoControlId={pc.id}
            puntoControlNombre={pc.nombre}
            lineaProductivaId={lineaId}
            schemaJson={(pc.schemaJson as object) ?? {}}
            productoActivo={productoActivo}
          />
        )}
      </main>
    </div>
  );
}
