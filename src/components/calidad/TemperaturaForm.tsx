"use client";
import { hoyPlanta, horaPlanta } from "@/lib/calidad/fecha-planta";

import { useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { NumpadIndustrial } from "@/components/calidad/NumpadIndustrial";
import { useBatchGuardar } from "@/hooks/useBatchGuardar";
import { RegistrosDelDia, useRegistrosDelDia } from "@/components/calidad/RegistrosDelDia";
import { ProductoActivoBanner } from "@/components/calidad/ProductoActivoBanner";
import type { ProductoActivoLinea } from "@/types/calidad";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type TipoFormularioTemp = "temperatura_condensacion" | "temperatura_tanques";

type Props = {
  puntoControlId: string;
  lineaProductivaId: string;
  tipoFormulario: TipoFormularioTemp;
  productoActivo: ProductoActivoLinea;
};

type CampoConfig = { key: string; label: string; requerido: boolean; unidad?: string };
type MuestraTemp = { id: number; hora: string; notas: string; tipo_producto: string; campos: Record<string, string> };

// ─── Config por tipo ─────────────────────────────────────────────────────────

const CONFIGS: Record<TipoFormularioTemp, { titulo: string; tieneSelector: boolean; tieneTiempoTunel: boolean; tipoOpciones: { valor: string; label: string }[]; campos: CampoConfig[] }> = {
  temperatura_condensacion: {
    titulo: "Control Temp. Condensación",
    tieneSelector: false,
    // Tiempo de túnel: se registra una vez por jornada (no por muestra)
    tieneTiempoTunel: true,
    tipoOpciones: [],
    campos: [
      { key: "humedad_relativa", label: "Humedad relativa (%)", requerido: true },
      { key: "temp_ambiente",    label: "T° ambiente (°C)",     requerido: true },
      { key: "temp_producto",    label: "T° producto salida (°C)", requerido: true },
      { key: "temp_rocio",       label: "Punto de rocío Td (°C)", requerido: true },
      { key: "temp_condensacion",label: "T° condensación (°C)", requerido: true },
      { key: "temp_interna",     label: "T° interna producto (°C)", requerido: true },
      { key: "peso",             label: "Peso (g)",             requerido: true },
      { key: "espesor",          label: "Espesor (mm)",         requerido: true },
    ],
  },
  temperatura_tanques: {
    titulo: "Control Temp. Tanques",
    tieneSelector: false,
    tieneTiempoTunel: false,
    tipoOpciones: [],
    campos: [
      { key: "temp_ddl",           label: "Tanque DDL (°C)",         requerido: true },
      { key: "temp_bon_o_bon",     label: "Tanque Bon o Bon (°C)",   requerido: false },
      { key: "tanque_1_cobertura", label: "Tanque 1 Cobertura (°C)", requerido: false },
      { key: "tanque_2_cobertura", label: "Tanque 2 Cobertura (°C)", requerido: false },
    ],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function crearMuestra(id: number, tipoDefault: string, campos: CampoConfig[]): MuestraTemp {
  return {
    id,
    hora: horaPlanta(),
    notas: "",
    tipo_producto: tipoDefault,
    campos: Object.fromEntries(campos.map((c) => [c.key, ""])),
  };
}

// ─── Pantalla de éxito ────────────────────────────────────────────────────────

function PantallaExito() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900">Registro guardado</h2>
      <p className="text-gray-500 text-sm">Volviendo al módulo de Calidad...</p>
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

// Sentinel para el numpad del tiempo de túnel (campoActivo es string | null)
const CAMPO_TIEMPO_TUNEL = "__tiempo_tunel__";

export function TemperaturaForm({ puntoControlId, lineaProductivaId, tipoFormulario, productoActivo }: Props) {
  const { data: session } = useSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const { enviando, error, exito, guardar } = useBatchGuardar("/calidad", () => setRefreshKey((k) => k + 1));
  const { registros: registrosHoy, cargando: cargandoHoy, esDemo } = useRegistrosDelDia(puntoControlId, lineaProductivaId, refreshKey);

  const config = CONFIGS[tipoFormulario];
  const tipoDefault = config.tipoOpciones[0]?.valor ?? "";

  const loteId = productoActivo.loteId;
  const [muestras, setMuestras] = useState<MuestraTemp[]>([crearMuestra(1, tipoDefault, config.campos)]);
  const [muestraActivaId, setMuestraActivaId] = useState(1);
  const [campoActivo, setCampoActivo] = useState<string | null>(null); // key del campo
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  // Tiempo de túnel: una vez por jornada. Si ya hay uno hoy, se muestra; editable.
  const [tiempoTunel, setTiempoTunel] = useState("");
  const tunelRegistradoHoy = useMemo(() => {
    for (const r of registrosHoy) {
      const t = r.data?.tiempo_tunel_min;
      if (t !== undefined && t !== null && t !== "") {
        return { valor: Number(t), hora: r.hora?.slice(0, 5) ?? "" };
      }
    }
    return null;
  }, [registrosHoy]);

  const muestraActiva = muestras.find((m) => m.id === muestraActivaId)!;
  const muestraActivaIdx = muestras.findIndex((m) => m.id === muestraActivaId);

  const updateMuestra = useCallback((patch: Partial<MuestraTemp>) => {
    setMuestras((prev) => prev.map((m) => (m.id === muestraActivaId ? { ...m, ...patch } : m)));
  }, [muestraActivaId]);

  const updateCampo = useCallback((key: string, val: string) => {
    setMuestras((prev) =>
      prev.map((m) =>
        m.id === muestraActivaId ? { ...m, campos: { ...m.campos, [key]: val } } : m
      )
    );
  }, [muestraActivaId]);

  const onNumpadCambio = (v: string) => {
    if (!campoActivo) return;
    if (campoActivo === CAMPO_TIEMPO_TUNEL) { setTiempoTunel(v); return; }
    updateCampo(campoActivo, v);
  };

  const onNumpadConfirmar = () => {
    if (!campoActivo) return;
    if (campoActivo === CAMPO_TIEMPO_TUNEL) { setCampoActivo(null); return; }
    const idx = config.campos.findIndex((c) => c.key === campoActivo);
    const siguiente = config.campos[idx + 1];
    setCampoActivo(siguiente ? siguiente.key : null);
  };

  const agregarMuestra = () => {
    const nuevoId = Math.max(...muestras.map((m) => m.id)) + 1;
    const nueva = crearMuestra(nuevoId, muestraActiva.tipo_producto, config.campos);
    nueva.hora = horaPlanta();
    setMuestras((prev) => [...prev, nueva]);
    setMuestraActivaId(nuevoId);
    setCampoActivo(null);
  };

  const eliminarMuestraActiva = () => {
    if (muestras.length <= 1) return;
    const nuevas = muestras.filter((m) => m.id !== muestraActivaId);
    setMuestras(nuevas);
    setMuestraActivaId(nuevas[Math.max(0, muestraActivaIdx - 1)].id);
    setCampoActivo(null);
  };

  const onGuardar = async () => {
    // Validar TODAS las muestras, no solo la activa
    for (const m of muestras) {
      const faltantes = config.campos.filter((c) => c.requerido && !m.campos[c.key]);
      if (faltantes.length > 0) {
        setErrorValidacion(`M${m.id}: falta ${faltantes[0].label}`);
        setMuestraActivaId(m.id);
        return;
      }
    }
    setErrorValidacion(null);

    const hoy = hoyPlanta();
    const registros = muestras.map((m, idx) => {
      const data: Record<string, unknown> = {};
      if (config.tieneSelector) data.tipo_producto = m.tipo_producto;
      for (const c of config.campos) {
        if (m.campos[c.key] !== "") data[c.key] = parseFloat(m.campos[c.key]);
      }
      if (m.notas) data.observaciones = m.notas;
      // Tiempo de túnel viaja una sola vez por batch, en la primera muestra
      if (idx === 0 && config.tieneTiempoTunel && tiempoTunel) data.tiempo_tunel_min = parseFloat(tiempoTunel);
      // Continúa la numeración del día — evita colisión del unique [pc, lote, fecha, nroMuestra]
      return { puntoControlId, loteId, lineaProductivaId, fecha: hoy, hora: m.hora + ":00", nroMuestra: registrosHoy.length + idx + 1, data };
    });

    await guardar(registros);
  };

  const esNumpadTunel = campoActivo === CAMPO_TIEMPO_TUNEL;
  const valorNumpad = !campoActivo ? "" : esNumpadTunel ? tiempoTunel : muestraActiva.campos[campoActivo] ?? "";
  const labelNumpad = esNumpadTunel ? "Tiempo de Túnel (min)" : config.campos.find((c) => c.key === campoActivo)?.label ?? "";

  const completados = config.campos.filter((c) => c.requerido && muestraActiva.campos[c.key] !== "").length;
  const requeridos = config.campos.filter((c) => c.requerido).length;

  if (exito) return <PantallaExito />;

  return (
    <div className="space-y-4" onClick={() => { if (campoActivo) setCampoActivo(null); }}>

      {/* Producto en producción */}
      <div onClick={(e) => e.stopPropagation()}>
        <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />
      </div>

      {/* Tiempo de Túnel — una vez por jornada (solo condensación) */}
      {config.tieneTiempoTunel && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tiempo de Túnel</p>
              {tunelRegistradoHoy && !tiempoTunel ? (
                <p className="text-sm text-gray-800 mt-1">
                  <span className="font-bold font-mono">{tunelRegistradoHoy.valor} min</span>
                  <span className="text-xs text-gray-400 ml-2">registrado hoy a las {tunelRegistradoHoy.hora}</span>
                </p>
              ) : (
                <p className={`text-xl font-bold font-mono mt-0.5 ${tiempoTunel ? "text-gray-900" : "text-gray-300"}`}>
                  {tiempoTunel || "—"}{tiempoTunel && <span className="text-xs font-normal text-gray-400 ml-1">min</span>}
                </p>
              )}
            </div>
            <button type="button"
              onClick={() => {
                if (!tiempoTunel && tunelRegistradoHoy) setTiempoTunel(String(tunelRegistradoHoy.valor));
                setCampoActivo(CAMPO_TIEMPO_TUNEL);
              }}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95 ${esNumpadTunel ? "border-[#E1000F] bg-red-50 text-[#E1000F]" : "border-gray-200 bg-gray-50 text-gray-600"}`}>
              {tunelRegistradoHoy || tiempoTunel ? "Editar" : "Cargar"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Se registra una vez por jornada. Si cambia la velocidad de línea, registrarlo de nuevo.</p>
        </div>
      )}

      {/* Tabs de muestras */}
      <div className="bg-[#f0f0f0] rounded-xl p-3 flex items-center gap-2 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
        {muestras.map((m) => {
          const comp = config.campos.filter((c) => c.requerido && m.campos[c.key] !== "").length;
          return (
            <div key={m.id} className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => { setMuestraActivaId(m.id); setCampoActivo(null); }}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 ${m.id === muestraActivaId ? "bg-white text-[#E1000F] shadow border border-gray-200" : "text-gray-600 hover:bg-white/60"}`}
              >
                M{m.id} {comp === requeridos && <span className="text-green-500 text-xs">✓</span>}
              </button>
              {muestras.length > 1 && m.id === muestraActivaId && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); eliminarMuestraActiva(); }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                >×</button>
              )}
            </div>
          );
        })}
        <button type="button" onClick={agregarMuestra} className="flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-white/60 flex items-center gap-1 transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Muestra
        </button>
      </div>

      {/* Datos de muestra */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          <span className="text-xs text-gray-500">Registrando como:</span>
          <span className="text-xs font-semibold text-gray-800">{session?.user?.name ?? "—"}</span>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Hora de muestra</label>
          <input type="time" value={muestraActiva.hora} onChange={(e) => updateMuestra({ hora: e.target.value })}
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none" />
        </div>
        {config.tieneSelector && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tipo de producto</p>
            <div className="flex flex-wrap gap-2">
              {config.tipoOpciones.map((op) => (
                <button key={op.valor} type="button" onClick={() => updateMuestra({ tipo_producto: op.valor })}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95 ${muestraActiva.tipo_producto === op.valor ? "bg-[#E1000F] text-white border-[#E1000F] shadow" : "bg-gray-100 text-gray-700 border-gray-200"}`}>
                  {op.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Grilla de campos */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700">Mediciones — Muestra {muestraActiva.id}</h2>
          <span className="text-xs text-gray-400 font-medium">{completados}/{requeridos} requeridos</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {config.campos.map((campo) => {
            const val = muestraActiva.campos[campo.key];
            const isActivo = campoActivo === campo.key;
            const tieneValor = val !== "";
            return (
              <button key={campo.key} type="button" onClick={() => setCampoActivo(campo.key)}
                className={`rounded-xl border-2 p-3 text-left transition-all active:scale-95 ${isActivo ? "border-[#E1000F] bg-red-50 shadow-md" : tieneValor ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50 hover:bg-gray-100"}`}>
                <p className="text-xs text-gray-500 mb-0.5 leading-tight">
                  {campo.label} {campo.requerido && <span className="text-red-400">*</span>}
                </p>
                <p className={`text-xl font-bold font-mono ${tieneValor ? "text-gray-900" : "text-gray-300"}`}>{val || "—"}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notas */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Observaciones (opcional)</label>
        <textarea value={muestraActiva.notas} onChange={(e) => updateMuestra({ notas: e.target.value })} rows={2}
          placeholder="Observaciones de la muestra..."
          className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none" />
      </div>

      {/* Resumen de la sesión — muestras cargadas hasta ahora */}
      {muestras.some((m) => Object.values(m.campos).some((v) => v !== "")) && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Resumen de la sesión</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left py-1.5 pr-2 font-semibold">M</th>
                  <th className="text-left py-1.5 pr-2 font-semibold">Hora</th>
                  {config.campos.map((c) => (
                    <th key={c.key} className="text-right py-1.5 px-1.5 font-semibold whitespace-nowrap">{c.label.replace(" (°C)", "").replace(" (%)", "").replace(" (g)", "").replace(" (mm)", "")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {muestras.map((m) => (
                  <tr key={m.id} className={`border-b border-gray-50 ${m.id === muestraActivaId ? "bg-red-50/50" : ""}`}>
                    <td className="py-1.5 pr-2 font-bold text-gray-600">M{m.id}</td>
                    <td className="py-1.5 pr-2 font-mono text-gray-500">{m.hora}</td>
                    {config.campos.map((c) => (
                      <td key={c.key} className="text-right py-1.5 px-1.5 font-mono font-semibold text-gray-800">
                        {m.campos[c.key] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(error || errorValidacion) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{errorValidacion ?? error}</div>
      )}

      {/* Registros ya cargados hoy — mismo fetch del hook, sin duplicar request */}
      <div onClick={(e) => e.stopPropagation()}>
        <RegistrosDelDia
          puntoControlId={puntoControlId}
          lineaProductivaId={lineaProductivaId}
          registros={registrosHoy}
          cargando={cargandoHoy}
          esDemo={esDemo}
        />
      </div>

      <div className="h-20" />

      {campoActivo && (
        <div onClick={(e) => e.stopPropagation()}>
          <NumpadIndustrial valor={valorNumpad} onCambio={onNumpadCambio} onConfirmar={onNumpadConfirmar} label={labelNumpad}
            onCerrar={() => {
              // Cerrar sin OK descarta el valor no confirmado del túnel — evita
              // reenviar tiempo_tunel_min en un registro nuevo y duplicar la
              // carga "una vez por jornada".
              if (esNumpadTunel) setTiempoTunel("");
              setCampoActivo(null);
            }} />
        </div>
      )}

      {!campoActivo && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-20">
          <div className="max-w-2xl mx-auto">
            <button type="button" onClick={onGuardar} disabled={enviando}
              className="w-full py-4 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200">
              {enviando ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Guardando...
                </span>
              ) : `Guardar — ${muestras.length} muestra${muestras.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
