"use client";
import { hoyPlanta, horaPlanta } from "@/lib/calidad/fecha-planta";

import { useMemo, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { NumpadIndustrial } from "@/components/calidad/NumpadIndustrial";
import { useBatchGuardar } from "@/hooks/useBatchGuardar";
import { RegistrosDelDia, useRegistrosDelDia } from "@/components/calidad/RegistrosDelDia";
import { calcularVencimiento } from "@/lib/calidad/lote-pt";
import { ProductoActivoBanner } from "@/components/calidad/ProductoActivoBanner";
import type { ProductoActivoLinea } from "@/types/calidad";

type Props = { puntoControlId: string; lineaProductivaId: string; productoActivo: ProductoActivoLinea };

type CampoNumerico = "cajas" | "peso_alfajor";
type Entrada = {
  id: string;
  cajas: string;
  peso_alfajor: string;
  pallet_incompleto: boolean;
  lote_pt: string;
  observaciones: string;
};

// cajasIniciales: el estándar del maestro (cajasPorPallet) cuando existe — el
// pallet nace con la cantidad estándar y solo se edita marcándolo incompleto.
function crearEntrada(cajasIniciales: string): Entrada {
  return {
    id: Math.random().toString(36).slice(2),
    cajas: cajasIniciales,
    peso_alfajor: "",
    pallet_incompleto: false,
    lote_pt: "",
    observaciones: "",
  };
}

type CampoActivo =
  | { entradaId: string; campo: CampoNumerico }
  | { entradaId: null; campo: "tiempo_tunel" }
  | null;

const CAMPOS_NUMERICOS: { key: CampoNumerico; label: string; unidad?: string }[] = [
  { key: "cajas", label: "Cajas producidas", unidad: "cajas" },
  { key: "peso_alfajor", label: "Peso del alfajor", unidad: "g" },
];

export function ProduccionDiariaForm({ puntoControlId, lineaProductivaId, productoActivo }: Props) {
  const { data: session } = useSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const { enviando, error, exito, guardar } = useBatchGuardar(`/calidad/puntos-control?linea=${lineaProductivaId}`, () => setRefreshKey((k) => k + 1));
  const { registros: registrosHoy, cargando: cargandoHoy, esDemo } = useRegistrosDelDia(puntoControlId, lineaProductivaId, refreshKey);

  const loteId = productoActivo.loteId;
  // Estándar de cajas por pallet del maestro: con estándar, el campo queda
  // bloqueado en ese valor y solo se edita marcando el pallet como incompleto
  // (regla auditada por scm-alimentos — divergencia = declaración explícita).
  const cajasEstandar = productoActivo.cajasPorPallet != null ? String(productoActivo.cajasPorPallet) : null;
  const [entradas, setEntradas] = useState<Entrada[]>([crearEntrada(cajasEstandar ?? "")]);
  const [campoActivo, setCampoActivo] = useState<CampoActivo>(null);
  const [validar, setValidar] = useState(false);
  const [hora, setHora] = useState(horaPlanta());
  const [horaEditada, setHoraEditada] = useState(false);

  // Tiempo de túnel: una vez por turno. Si ya hay uno hoy, se muestra; editable.
  const [tiempoTunel, setTiempoTunel] = useState("");
  const [editandoTunel, setEditandoTunel] = useState(false);

  // Correlativo automático: max(pallet_numero de hoy) + posición de la entrada
  const maxPalletHoy = useMemo(() => {
    let max = 0;
    for (const r of registrosHoy) {
      const n = Number(r.data?.pallet_numero);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }, [registrosHoy]);

  const tunelRegistradoHoy = useMemo(() => {
    for (const r of registrosHoy) {
      const t = r.data?.tiempo_tunel_min;
      if (t !== undefined && t !== null && t !== "") {
        return { valor: Number(t), hora: r.hora?.slice(0, 5) ?? "" };
      }
    }
    return null;
  }, [registrosHoy]);

  const numeroPallet = useCallback((idx: number) => maxPalletHoy + idx + 1, [maxPalletHoy]);

  const vencimientoCalculado = productoActivo.vidaUtilMeses
    ? calcularVencimiento(new Date(), productoActivo.vidaUtilMeses)
    : null;
  const [vencimientoManual, setVencimientoManual] = useState("");

  const updateEntrada = useCallback((id: string, patch: Partial<Entrada>) => {
    setEntradas((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const agregarEntrada = () => {
    setEntradas((prev) => [...prev, crearEntrada(cajasEstandar ?? "")]);
    setCampoActivo(null);
  };

  const eliminarEntrada = (id: string) => {
    if (entradas.length === 1) return;
    setEntradas((prev) => prev.filter((e) => e.id !== id));
    if (campoActivo && "entradaId" in campoActivo && campoActivo.entradaId === id) setCampoActivo(null);
  };

  const entradaActiva =
    campoActivo && campoActivo.entradaId ? entradas.find((e) => e.id === campoActivo.entradaId) : null;

  const onNumpadCambio = (v: string) => {
    if (!campoActivo) return;
    if (campoActivo.campo === "tiempo_tunel") {
      setTiempoTunel(v);
      return;
    }
    if (!entradaActiva) return;
    const valor = campoActivo.campo === "cajas" ? v.replace(".", "") : v;
    updateEntrada(campoActivo.entradaId as string, { [campoActivo.campo]: valor });
  };

  const onNumpadConfirmar = () => {
    if (!campoActivo) return;
    if (campoActivo.campo === "tiempo_tunel") {
      setCampoActivo(null);
      setEditandoTunel(false);
      return;
    }
    const idx = CAMPOS_NUMERICOS.findIndex((c) => c.key === campoActivo.campo);
    if (idx < CAMPOS_NUMERICOS.length - 1) {
      setCampoActivo({ entradaId: campoActivo.entradaId, campo: CAMPOS_NUMERICOS[idx + 1].key });
    } else {
      setCampoActivo(null);
    }
  };

  const vencimientoFinal = vencimientoCalculado ?? vencimientoManual;

  const camposIncompletos = (e: Entrada) => {
    if (!e.cajas) return "Ingresá la cantidad de cajas";
    if (parseInt(e.cajas) <= 0) return "La cantidad de cajas debe ser mayor a 0";
    if (!e.peso_alfajor) return "Ingresá el peso del alfajor";
    if (!e.lote_pt.trim()) return "Ingresá el código de lote PT";
    return null;
  };

  const onGuardar = async () => {
    setValidar(true);
    if (!vencimientoFinal.trim()) return;
    for (const entrada of entradas) {
      if (camposIncompletos(entrada)) return;
    }

    // El último pallet del turno es estadísticamente el parcial (scm-alimentos):
    // si quedó con el estándar sin tocar, pedir confirmación explícita antes de
    // guardarlo — evita declarar cajas que no existen en el balance del lote.
    const ultima = entradas[entradas.length - 1];
    if (cajasEstandar !== null && !ultima.pallet_incompleto) {
      const ok = window.confirm(
        `¿Confirmás ${ultima.cajas} cajas (estándar completo) en el pallet N° ${numeroPallet(entradas.length - 1)}?\n\nSi quedó incompleto, cancelá y marcalo para cargar la cantidad real.`
      );
      if (!ok) return;
    }

    const hoy = hoyPlanta();
    // Hora fresca al momento de guardar, salvo que el operario la haya ajustado
    const horaGuardado = horaEditada ? hora : horaPlanta();
    const registros = entradas.map((e, idx) => {
      const data: Record<string, unknown> = {
        cajas: parseInt(e.cajas),
        pallet_numero: numeroPallet(idx),
        peso_alfajor: parseFloat(e.peso_alfajor),
        lote_pt: e.lote_pt.trim(),
        vencimiento_pt: vencimientoFinal.trim(),
      };
      if (e.pallet_incompleto) data.pallet_incompleto = true;
      if (e.observaciones.trim()) data.observaciones = e.observaciones.trim();
      // Tiempo de túnel viaja una sola vez por batch, en la primera entrada
      if (idx === 0 && tiempoTunel) data.tiempo_tunel_min = parseFloat(tiempoTunel);

      return { puntoControlId, loteId, lineaProductivaId, fecha: hoy, hora: horaGuardado + ":00", nroMuestra: registrosHoy.length + idx + 1, data };
    });

    await guardar(registros);
  };

  if (exito) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900">{entradas.length} {entradas.length === 1 ? "pallet guardado" : "pallets guardados"}</h2>
      <p className="text-gray-500 text-sm">Volviendo a puntos de control...</p>
    </div>
  );

  const totalCajas = entradas.reduce((sum, e) => sum + (parseInt(e.cajas) || 0), 0);
  const mostrarNumpadTunel = campoActivo?.campo === "tiempo_tunel";

  return (
    <div className="space-y-4" onClick={() => { if (campoActivo) setCampoActivo(null); }}>

      {/* Cabecera */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div onClick={(e) => e.stopPropagation()}>
          <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />
        </div>

        {/* Vencimiento: derivado del producto; editable solo si falta el dato maestro */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Vencimiento PT</label>
            {vencimientoCalculado ? (
              <div className="flex items-center gap-2 py-2.5 px-3 rounded-xl bg-green-50 border-2 border-green-200">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm font-bold text-green-800 font-mono">{vencimientoCalculado}</span>
                <span className="text-xs text-green-600">({productoActivo.vidaUtilMeses} meses)</span>
              </div>
            ) : (
              <input type="text" value={vencimientoManual} placeholder="Ej: 04/2027"
                onChange={(e) => setVencimientoManual(e.target.value)}
                className={`w-full py-2.5 px-3 rounded-xl border-2 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none ${validar && !vencimientoFinal ? "border-red-300" : "border-gray-200"}`} />
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Hora</label>
            <input type="time" value={hora} onChange={(e) => { setHora(e.target.value); setHoraEditada(true); }}
              className="py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none text-sm" />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex items-center gap-2 flex-1 bg-gray-50 rounded-xl px-3 py-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <span className="text-xs font-semibold text-gray-800 truncate">{session?.user?.name ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>
            <span className="text-xs font-bold text-blue-700">{totalCajas} cajas</span>
          </div>
        </div>
      </div>

      {/* Tiempo de Túnel — una vez por turno */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tiempo de Túnel</p>
            {tunelRegistradoHoy && !editandoTunel && !tiempoTunel ? (
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
              // Precargar el valor ya registrado hoy para no obligar a retipearlo
              if (!tiempoTunel && tunelRegistradoHoy) setTiempoTunel(String(tunelRegistradoHoy.valor));
              setEditandoTunel(true);
              setCampoActivo({ entradaId: null, campo: "tiempo_tunel" });
            }}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95 ${mostrarNumpadTunel ? "border-[#E1000F] bg-red-50 text-[#E1000F]" : "border-gray-200 bg-gray-50 text-gray-600"}`}>
            {tunelRegistradoHoy || tiempoTunel ? "Editar" : "Cargar"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Se registra una vez por turno. Si cambia la velocidad de línea, registrarlo de nuevo.</p>
      </div>

      {/* Entradas = pallets */}
      {entradas.map((entrada, idx) => {
        const errEntrada = validar ? camposIncompletos(entrada) : null;
        return (
          <div key={entrada.id} className={`bg-white rounded-2xl border-2 overflow-hidden transition-all ${errEntrada ? "border-red-200" : "border-gray-100"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white bg-[#E1000F] rounded-lg px-2.5 py-1">Pallet N° {numeroPallet(idx)}</span>
                {entrada.pallet_incompleto && <span className="text-xs font-semibold text-amber-700 bg-amber-100 rounded-lg px-2 py-1">Incompleto</span>}
              </div>
              {entradas.length > 1 && (
                <button type="button" onClick={() => eliminarEntrada(entrada.id)}
                  className="text-xs text-red-500 font-semibold px-2 py-1 rounded-lg hover:bg-red-50 active:scale-95 transition-all">
                  Eliminar
                </button>
              )}
            </div>
            <div className="p-4 space-y-4">
              {/* Campos numéricos */}
              <div className="grid grid-cols-2 gap-2">
                {CAMPOS_NUMERICOS.map(({ key, label, unidad }) => {
                  const activo = campoActivo && "entradaId" in campoActivo && campoActivo.entradaId === entrada.id && campoActivo.campo === key;
                  // Con estándar del maestro y pallet completo, las cajas quedan
                  // bloqueadas en el estándar — se editan marcando el pallet incompleto.
                  const bloqueado = key === "cajas" && cajasEstandar !== null && !entrada.pallet_incompleto;
                  return (
                    <button key={key} type="button" aria-disabled={bloqueado}
                      onClick={() => { if (!bloqueado) setCampoActivo({ entradaId: entrada.id, campo: key }); }}
                      className={`rounded-xl border-2 p-2 text-left transition-all ${bloqueado ? "border-green-200 bg-green-50/60 cursor-default" : `active:scale-95 ${activo ? "border-[#E1000F] bg-red-50" : entrada[key] ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"}`}`}>
                      <p className="text-xs text-gray-400 truncate">{label}</p>
                      <p className={`text-xl font-bold font-mono mt-0.5 ${entrada[key] ? "text-gray-900" : "text-gray-300"}`}>
                        {entrada[key] || "—"}{entrada[key] && unidad ? <span className="text-xs font-normal text-gray-400 ml-0.5">{unidad}</span> : null}
                      </p>
                      {bloqueado && <p className="text-[11px] text-green-600 mt-0.5">Estándar del producto</p>}
                    </button>
                  );
                })}
              </div>

              {/* Pallet incompleto — con estándar, es la única vía para editar cajas */}
              <button type="button"
                onClick={(ev) => {
                  const marcar = !entrada.pallet_incompleto;
                  if (cajasEstandar !== null) {
                    if (marcar) {
                      // Limpia el estándar y abre el numpad para cargar la cantidad real
                      updateEntrada(entrada.id, { pallet_incompleto: true, cajas: "" });
                      setCampoActivo({ entradaId: entrada.id, campo: "cajas" });
                      // El numpad (panel fijo bottom, ~320px) tapa esta card en
                      // pantallas bajas. Alinear la card arriba del viewport deja
                      // campos y toggle en la zona visible sobre el panel. Diferido
                      // para que React ya haya agrandado el spacer del fondo (si no,
                      // el scroll se recorta). scrollIntoView (y no window.scrollBy)
                      // porque el scroll puede vivir en un contenedor interno.
                      const card = ev.currentTarget.closest("div.bg-white");
                      setTimeout(() => card?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
                    } else {
                      // Desmarcar restaura el estándar
                      updateEntrada(entrada.id, { pallet_incompleto: false, cajas: cajasEstandar });
                      if (campoActivo && "entradaId" in campoActivo && campoActivo.entradaId === entrada.id && campoActivo.campo === "cajas") {
                        setCampoActivo(null);
                      }
                    }
                  } else {
                    updateEntrada(entrada.id, { pallet_incompleto: marcar });
                  }
                }}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95 ${entrada.pallet_incompleto ? "bg-amber-100 border-amber-300 text-amber-800" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
                {entrada.pallet_incompleto ? "✓ Marcado como incompleto — se registra la cantidad de cajas que lleva" : "¿El pallet quedó incompleto?"}
              </button>

              {/* Lote PT: carga 100% manual — el código lo pone el codificador de
                  planta en el pallet físico, no lo calcula el sistema. */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Lote PT</label>
                <input type="text" value={entrada.lote_pt} placeholder="Ej: L20260707-01"
                  onChange={(e) => updateEntrada(entrada.id, { lote_pt: e.target.value })}
                  className="w-full py-2 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm font-mono text-gray-900 focus:border-[#E1000F] focus:outline-none" />
              </div>

              {/* Observaciones */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Observaciones (opcional)</label>
                <textarea value={entrada.observaciones} onChange={(e) => updateEntrada(entrada.id, { observaciones: e.target.value })}
                  rows={2} placeholder="Novedades en este pallet..."
                  className="w-full py-2 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none" />
              </div>

              {errEntrada && <p className="text-xs text-red-600 font-medium">{errEntrada}</p>}
            </div>
          </div>
        );
      })}

      {/* Agregar pallet */}
      <button type="button" onClick={agregarEntrada}
        className="w-full py-3.5 rounded-2xl border-2 border-dashed border-gray-300 text-sm font-semibold text-gray-500 hover:border-[#E1000F] hover:text-[#E1000F] active:scale-95 transition-all flex items-center justify-center gap-2">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        Agregar pallet (N° {numeroPallet(entradas.length)})
      </button>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

      {/* Registros del día — por qué pallet va */}
      <div onClick={(e) => e.stopPropagation()}>
        <RegistrosDelDia
          puntoControlId={puntoControlId}
          lineaProductivaId={lineaProductivaId}
          titulo="Pallets registrados hoy"
          registros={registrosHoy}
          cargando={cargandoHoy}
          esDemo={esDemo}
          renderItem={(r) => (
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-white bg-gray-700 rounded-lg px-2 py-1 shrink-0">
                Pallet {String(r.data?.pallet_numero ?? "—")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800">
                  {String(r.data?.cajas ?? "—")} cajas
                  {r.data?.pallet_incompleto ? " · incompleto" : ""}
                  {r.data?.lote_pt ? ` · Lote ${String(r.data.lote_pt)}` : ""}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {r.hora?.slice(0, 5)} · {r.responsable?.nombre ?? "—"}
                </p>
              </div>
            </div>
          )}
        />
      </div>

      {/* Con el numpad abierto, dejar aire para poder scrollear cualquier card
          del form por encima del panel fijo (~320px) */}
      <div className={campoActivo ? "h-[340px]" : "h-20"} />

      {campoActivo && (
        <div onClick={(e) => e.stopPropagation()}>
          <NumpadIndustrial
            valor={mostrarNumpadTunel ? tiempoTunel : entradaActiva?.[campoActivo.campo as CampoNumerico] ?? ""}
            onCambio={onNumpadCambio}
            onConfirmar={onNumpadConfirmar}
            label={mostrarNumpadTunel ? "Tiempo de Túnel (min)" : CAMPOS_NUMERICOS.find((c) => c.key === campoActivo.campo)?.label ?? ""}
            onCerrar={() => {
              // Cerrar sin OK descarta el valor: si ya había uno registrado hoy,
              // evita reenviarlo en un registro nuevo y duplicar la carga "una vez
              // por jornada"; si no había, evita commitear un valor a medio tipear.
              if (mostrarNumpadTunel) setTiempoTunel("");
              setCampoActivo(null);
              setEditandoTunel(false);
            }}
          />
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
              ) : `Guardar ${entradas.length} ${entradas.length === 1 ? "pallet" : "pallets"} — ${totalCajas} cajas`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
