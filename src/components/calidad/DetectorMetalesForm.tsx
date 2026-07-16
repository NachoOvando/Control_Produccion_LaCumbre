"use client";
import { hoyPlanta, horaPlanta } from "@/lib/calidad/fecha-planta";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { NumpadIndustrial } from "@/components/calidad/NumpadIndustrial";
import { useBatchGuardar } from "@/hooks/useBatchGuardar";
import { ProductoActivoBanner } from "@/components/calidad/ProductoActivoBanner";
import type { ProductoActivoLinea } from "@/types/calidad";

type Props = { puntoControlId: string; lineaProductivaId: string; productoActivo: ProductoActivoLinea };

type EstadoCNC = "conforme" | "no_conforme" | null;
type FormData = {
  patron_fe: EstadoCNC;
  patron_no_fe: EstadoCNC;
  patron_acero_inox: EstadoCNC;
  n_rechazos: string;
  gabinete_vacio_post: boolean | null;
  sensibilidad: string;
  programa: string;
  acciones: string;
  hora: string;
};

function crearFormVacio(): FormData {
  return {
    patron_fe: null,
    patron_no_fe: null,
    patron_acero_inox: null,
    n_rechazos: "",
    gabinete_vacio_post: null,
    sensibilidad: "",
    programa: "",
    acciones: "",
    hora: horaPlanta(),
  };
}

function CNCPar({ label, valor, onChange }: { label: string; valor: EstadoCNC; onChange: (v: EstadoCNC) => void }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange("conforme")}
          className={`flex-1 py-3.5 rounded-xl text-sm font-bold border-2 transition-all active:scale-95 ${valor === "conforme" ? "bg-green-500 text-white border-green-600 shadow" : "bg-green-50 text-green-700 border-green-200"}`}>
          C — Conforme
        </button>
        <button type="button" onClick={() => onChange("no_conforme")}
          className={`flex-1 py-3.5 rounded-xl text-sm font-bold border-2 transition-all active:scale-95 ${valor === "no_conforme" ? "bg-red-600 text-white border-red-700 shadow" : "bg-red-50 text-red-700 border-red-200"}`}>
          NC — No Conforme
        </button>
      </div>
    </div>
  );
}

export function DetectorMetalesForm({ puntoControlId, lineaProductivaId, productoActivo }: Props) {
  const { data: session } = useSession();
  const { enviando, error, exito, guardar } = useBatchGuardar();

  const loteId = productoActivo.loteId;
  const [form, setForm] = useState<FormData>(crearFormVacio());
  const [numpadActivo, setNumpadActivo] = useState(false);
  const [validar, setValidar] = useState(false);

  const update = (patch: Partial<FormData>) => setForm((prev) => ({ ...prev, ...patch }));

  const hayNC = form.patron_fe === "no_conforme" || form.patron_no_fe === "no_conforme" || form.patron_acero_inox === "no_conforme";
  const rechazosNum = form.n_rechazos !== "" ? parseInt(form.n_rechazos) : 0;
  const requiereAcciones = hayNC || rechazosNum > 0;

  const camposIncompletos = () => {
    if (!form.patron_fe) return "Completá el patrón Fe";
    if (!form.patron_no_fe) return "Completá el patrón No Fe";
    if (!form.patron_acero_inox) return "Completá el patrón Acero Inox";
    if (form.n_rechazos === "") return "Ingresá la cantidad de rechazos";
    if (form.gabinete_vacio_post === null) return "Indicá si el gabinete quedó vacío";
    if (requiereAcciones && !form.acciones.trim()) return "Las acciones correctivas son obligatorias cuando hay NC o rechazos";
    return null;
  };

  const onGuardar = async () => {
    setValidar(true);
    const error = camposIncompletos();
    if (error) return;

    const hoy = hoyPlanta();
    const data: Record<string, unknown> = {
      patron_fe: form.patron_fe,
      patron_no_fe: form.patron_no_fe,
      patron_acero_inox: form.patron_acero_inox,
      n_rechazos: rechazosNum,
      gabinete_vacio_post: form.gabinete_vacio_post,
    };
    if (form.sensibilidad) data.sensibilidad = form.sensibilidad;
    if (form.programa) data.programa = form.programa;
    if (form.acciones.trim()) data.acciones = form.acciones.trim();

    await guardar([{ puntoControlId, loteId, lineaProductivaId, fecha: hoy, hora: form.hora + ":00", nroMuestra: 1, data }]);
  };

  if (exito) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900">Verificación guardada</h2>
      <p className="text-gray-500 text-sm">Volviendo al módulo de Calidad...</p>
    </div>
  );

  const errValidacion = validar ? camposIncompletos() : null;

  return (
    <div className="space-y-4" onClick={() => { if (numpadActivo) setNumpadActivo(false); }}>

      {/* Banner PCC1 */}
      <div className="bg-red-600 text-white rounded-2xl p-4 flex items-center gap-3">
        <svg className="w-8 h-8 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p className="font-bold text-base leading-tight">PCC1 — Punto Crítico de Control</p>
          <p className="text-red-100 text-sm">Verificación horaria obligatoria. Documentar toda desviación.</p>
        </div>
      </div>

      {/* Lote + Hora */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div onClick={(e) => e.stopPropagation()}>
          <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />
        </div>
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          <span className="text-xs text-gray-500">Registrando como:</span>
          <span className="text-xs font-semibold text-gray-800">{session?.user?.name ?? "—"}</span>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Hora de verificación</label>
          <input type="time" value={form.hora} onChange={(e) => update({ hora: e.target.value })}
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none" />
        </div>
      </div>

      {/* Patrones C/NC */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-gray-700">Verificación de Patrones</h2>
        <CNCPar label="Patrón Ferroso (Fe)" valor={form.patron_fe} onChange={(v) => update({ patron_fe: v })} />
        <CNCPar label="Patrón No Ferroso (No Fe)" valor={form.patron_no_fe} onChange={(v) => update({ patron_no_fe: v })} />
        <CNCPar label="Patrón Acero Inoxidable (SS)" valor={form.patron_acero_inox} onChange={(v) => update({ patron_acero_inox: v })} />
      </div>

      {/* N° rechazos + gabinete */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">N° de rechazos en el período</p>
          <button type="button" onClick={() => setNumpadActivo(true)}
            className={`w-full rounded-xl border-2 p-3 text-left transition-all active:scale-95 ${numpadActivo ? "border-[#E1000F] bg-red-50" : form.n_rechazos !== "" ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
            <p className={`text-3xl font-bold font-mono text-center ${form.n_rechazos !== "" ? "text-gray-900" : "text-gray-300"}`}>
              {form.n_rechazos || "0"}
            </p>
          </button>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Gabinete vacío luego de la verificación</p>
          <div className="flex gap-2">
            {([{ v: true, l: "Sí — Vacío" }, { v: false, l: "No — Con producto" }] as { v: boolean; l: string }[]).map(({ v, l }) => (
              <button key={l} type="button" onClick={() => update({ gabinete_vacio_post: v })}
                className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all active:scale-95 ${form.gabinete_vacio_post === v ? v ? "bg-green-500 text-white border-green-600 shadow" : "bg-red-600 text-white border-red-700 shadow" : "bg-gray-100 text-gray-700 border-gray-200"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Campos opcionales */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Datos del equipo (opcional)</p>
        {[{ key: "sensibilidad", label: "Sensibilidad configurada" }, { key: "programa", label: "Programa activo (ej: PCC1)" }].map(({ key, label }) => (
          <div key={key}>
            <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
            <input type="text" value={form[key as keyof FormData] as string}
              onChange={(e) => update({ [key]: e.target.value } as Partial<FormData>)}
              className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none" />
          </div>
        ))}
      </div>

      {/* Acciones correctivas */}
      {requiereAcciones && (
        <div className="bg-amber-50 rounded-2xl p-4 border-2 border-amber-200" onClick={(e) => e.stopPropagation()}>
          <label className="block text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1.5">
            Acciones correctivas <span className="text-red-500">* obligatorio</span>
          </label>
          <textarea value={form.acciones} onChange={(e) => update({ acciones: e.target.value })} rows={3}
            placeholder="Describí las acciones tomadas ante la desviación..."
            className="w-full py-2.5 px-3 rounded-xl border-2 border-amber-300 bg-white text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none" />
        </div>
      )}

      {(error || errValidacion) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error ?? errValidacion}</div>
      )}
      <div className="h-20" />

      {numpadActivo && (
        <div onClick={(e) => e.stopPropagation()}>
          <NumpadIndustrial
            valor={form.n_rechazos}
            onCambio={(v) => { const entero = v.replace(".", ""); update({ n_rechazos: entero }); }}
            onConfirmar={() => setNumpadActivo(false)}
            label="N° de rechazos"
            onCerrar={() => setNumpadActivo(false)}
          />
        </div>
      )}

      {!numpadActivo && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-20">
          <div className="max-w-2xl mx-auto">
            <button type="button" onClick={onGuardar} disabled={enviando}
              className="w-full py-4 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200">
              {enviando ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Guardando...
                </span>
              ) : "Guardar verificación PCC1"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
