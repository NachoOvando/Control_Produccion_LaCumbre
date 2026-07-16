"use client";
import { hoyPlanta, horaPlanta } from "@/lib/calidad/fecha-planta";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useBatchGuardar } from "@/hooks/useBatchGuardar";
import { RegistrosDelDia, useRegistrosDelDia } from "@/components/calidad/RegistrosDelDia";
import { ProductoActivoBanner } from "@/components/calidad/ProductoActivoBanner";
import type { ProductoActivoLinea } from "@/types/calidad";

type Props = { puntoControlId: string; lineaProductivaId: string; productoActivo: ProductoActivoLinea };

const INSUMOS = [
  { valor: "tapas_banadas", label: "Tapas Bañadas" },
  { valor: "bonobon", label: "Bonobon" },
  { valor: "dulce_de_leche", label: "Dulce de Leche" },
  { valor: "bano_chocolate", label: "Baño Chocolate" },
] as const;

type InsumoValor = (typeof INSUMOS)[number]["valor"];

function labelInsumo(valor: string): string {
  return INSUMOS.find((i) => i.valor === valor)?.label ?? valor;
}

// Un registro por CAMBIO de lote de insumo: cuando entra en uso un lote nuevo se
// registra con hora, para cruzar con el correlativo de pallets ante un recall.
export function TrazabilidadInsumosForm({ puntoControlId, lineaProductivaId, productoActivo }: Props) {
  const { data: session } = useSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const { enviando, error, exito, guardar } = useBatchGuardar("/calidad/puntos-control", () => setRefreshKey((k) => k + 1));
  const { registros: registrosHoy, cargando: cargandoHoy, esDemo } = useRegistrosDelDia(puntoControlId, lineaProductivaId, refreshKey);

  const loteId = productoActivo.loteId;
  const [insumo, setInsumo] = useState<InsumoValor | "">("");
  const [loteInsumo, setLoteInsumo] = useState("");
  const [hora, setHora] = useState(horaPlanta());
  const [horaEditada, setHoraEditada] = useState(false);
  const [observaciones, setObservaciones] = useState("");
  const [validar, setValidar] = useState(false);

  // Último lote registrado hoy por tipo de insumo = "en uso ahora"
  const enUsoAhora = useMemo(() => {
    const porInsumo = new Map<string, { lote: string; hora: string }>();
    // registrosHoy viene ordenado por hora desc — el primero de cada insumo es el vigente
    for (const r of registrosHoy) {
      const ins = String(r.data?.insumo ?? "");
      if (ins && !porInsumo.has(ins)) {
        porInsumo.set(ins, { lote: String(r.data?.lote_insumo ?? "—"), hora: r.hora?.slice(0, 5) ?? "" });
      }
    }
    return porInsumo;
  }, [registrosHoy]);

  const onGuardar = async () => {
    setValidar(true);
    if (!insumo || !loteInsumo.trim()) return;

    const hoy = hoyPlanta();
    // Hora fresca al guardar salvo ajuste manual — clave para trazabilidad ante recall
    const horaGuardado = horaEditada ? hora : horaPlanta();
    const data: Record<string, unknown> = { insumo, lote_insumo: loteInsumo.trim() };
    if (observaciones.trim()) data.observaciones = observaciones.trim();

    await guardar([
      {
        puntoControlId,
        loteId,
        lineaProductivaId,
        fecha: hoy,
        hora: horaGuardado + ":00",
        nroMuestra: registrosHoy.length + 1,
        data,
      },
    ]);
  };

  if (exito) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900">Lote de insumo registrado</h2>
      <p className="text-gray-500 text-sm">Volviendo a puntos de control...</p>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* En uso ahora */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">En uso ahora</p>
        <div className="grid grid-cols-2 gap-2">
          {INSUMOS.map(({ valor, label }) => {
            const vigente = enUsoAhora.get(valor);
            return (
              <div key={valor} className={`rounded-xl border-2 p-3 ${vigente ? "border-green-200 bg-green-50" : "border-gray-100 bg-gray-50"}`}>
                <p className="text-xs text-gray-500">{label}</p>
                {vigente ? (
                  <>
                    <p className="text-sm font-bold font-mono text-gray-900 mt-0.5 truncate">{vigente.lote}</p>
                    <p className="text-xs text-gray-400">desde {vigente.hora}</p>
                  </>
                ) : (
                  <p className="text-sm text-gray-300 font-medium mt-0.5">Sin registro hoy</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Formulario de cambio de lote */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Registrar cambio de lote de insumo</p>

        {/* Insumo */}
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Insumo</p>
          <div className="grid grid-cols-2 gap-2">
            {INSUMOS.map(({ valor, label }) => (
              <button key={valor} type="button" onClick={() => setInsumo(valor)}
                className={`py-3.5 px-3 rounded-xl text-sm font-bold border-2 transition-all active:scale-95 ${insumo === valor ? "bg-[#E1000F] text-white border-[#c0000d] shadow" : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"}`}>
                {label}
              </button>
            ))}
          </div>
          {validar && !insumo && <p className="text-xs text-red-600 font-medium mt-1.5">Seleccioná el insumo</p>}
        </div>

        {/* Lote del insumo */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">N° de lote del insumo</label>
          <input type="text" value={loteInsumo} onChange={(e) => setLoteInsumo(e.target.value)}
            placeholder="Ej: NS-20260701-03"
            className={`w-full py-3 px-4 rounded-xl border-2 bg-gray-50 font-mono text-gray-900 focus:border-[#E1000F] focus:outline-none ${validar && !loteInsumo.trim() ? "border-red-300" : "border-gray-200"}`} />
          {validar && !loteInsumo.trim() && <p className="text-xs text-red-600 font-medium mt-1.5">Ingresá el lote del insumo</p>}
        </div>

        {/* Hora */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Hora de entrada en uso</label>
          <input type="time" value={hora} onChange={(e) => { setHora(e.target.value); setHoraEditada(true); }}
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none" />
        </div>

        {/* Producto en producción */}
        <div>
          <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />
        </div>

        {/* Observaciones */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Observaciones (opcional)</label>
          <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2}
            placeholder="Ej: cambio por fin de lote anterior..."
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none" />
        </div>

        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          <span className="text-xs text-gray-500">Registrando como:</span>
          <span className="text-xs font-semibold text-gray-800">{session?.user?.name ?? "—"}</span>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

      {/* Historial del día */}
      <RegistrosDelDia
        puntoControlId={puntoControlId}
        lineaProductivaId={lineaProductivaId}
        titulo="Cambios de lote registrados hoy"
        registros={registrosHoy}
        cargando={cargandoHoy}
        esDemo={esDemo}
        renderItem={(r) => (
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-semibold text-gray-500 bg-gray-100 rounded-lg px-2 py-1 shrink-0">
              {r.hora?.slice(0, 5) ?? "—"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800">
                <span className="font-semibold">{labelInsumo(String(r.data?.insumo ?? ""))}</span>
                {" — "}
                <span className="font-mono">{String(r.data?.lote_insumo ?? "—")}</span>
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{r.responsable?.nombre ?? "—"}</p>
            </div>
          </div>
        )}
      />

      <div className="h-20" />

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-20">
        <div className="max-w-2xl mx-auto">
          <button type="button" onClick={onGuardar} disabled={enviando}
            className="w-full py-4 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200">
            {enviando ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Guardando...
              </span>
            ) : "Registrar entrada en uso"}
          </button>
        </div>
      </div>
    </div>
  );
}
