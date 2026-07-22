"use client";
import { hoyPlanta, horaPlanta } from "@/lib/calidad/fecha-planta";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { NumpadIndustrial } from "@/components/calidad/NumpadIndustrial";
import { RegistrosDelDia } from "@/components/calidad/RegistrosDelDia";
import { ProductoActivoBanner } from "@/components/calidad/ProductoActivoBanner";
import { RangoObjetivo, IndicadorSpec, specDeCampo } from "@/components/calidad/IndicadorSpec";
import type { ProductoActivoLinea } from "@/types/calidad";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type TipoFormularioPeso = "peso_alfajor" | "peso_relleno" | "peso_bano";

type Props = {
  puntoControlId: string;
  lineaProductivaId: string;
  tipoFormulario: TipoFormularioPeso;
  familia?: string;
  productoActivo: ProductoActivoLinea;
};

type MuestraPeso = {
  id: number;
  hora: string;
  notas: string;
  mediciones: string[]; // 12 strings; se convierten a number al guardar
  tipo: string;         // discriminador por tipoFormulario
  tipo_relleno_otro: string; // aclaración cuando tipo = "otros" (solo peso_relleno)
  peso_tapa: string;
  presencia_bob: boolean | null; // solo peso_relleno
  penetrometria: string;         // solo peso_relleno
  temp_ambiente: string;         // solo peso_bano
  temp_bano: string;             // solo peso_bano
  escurrimiento: string;         // solo peso_bano
};

type CampoNumpad =
  | { origen: "medicion"; idx: number }
  | { origen: "extra"; campo: keyof Pick<MuestraPeso, "peso_tapa" | "penetrometria" | "temp_ambiente" | "temp_bano" | "escurrimiento"> };

// ─── Config por tipo ─────────────────────────────────────────────────────────

const CONFIG = {
  peso_alfajor: {
    tipoLabel: "Tipo de alfajor",
    tipoOpciones: [
      { valor: "sin_bano", label: "Sin baño" },
      { valor: "con_bano", label: "Con baño" },
    ],
    extraLabel: null,
  },
  peso_relleno: {
    tipoLabel: "Tipo de relleno",
    tipoOpciones: [
      { valor: "dulce_de_leche", label: "Dulce de Leche" },
      { valor: "bonobon", label: "Bonobon" },
      { valor: "ddl_bob", label: "DDL+BoB" },
      { valor: "otros", label: "Otros" },
    ],
    extraLabel: null,
  },
  peso_bano: {
    tipoLabel: "Tipo de producto",
    // "Solo baño" no se mide: el peso del baño surge de la resta c/baño − s/baño
    tipoOpciones: [
      { valor: "sandwich_sin_bano", label: "Sandwich s/baño" },
      { valor: "sandwich_con_bano", label: "Sandwich c/baño" },
    ],
    extraLabel: "Condiciones del baño",
  },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function crearMuestraVacia(id: number, tipoDefault: string): MuestraPeso {
  return {
    id,
    hora: horaPlanta(),
    notas: "",
    mediciones: Array(12).fill(""),
    tipo: tipoDefault,
    tipo_relleno_otro: "",
    peso_tapa: "",
    presencia_bob: null,
    penetrometria: "",
    temp_ambiente: "",
    temp_bano: "",
    escurrimiento: "",
  };
}

function calcularStats(mediciones: string[]) {
  const vals = mediciones
    .filter((v) => v !== "")
    .map(parseFloat)
    .filter((v) => !isNaN(v));

  if (vals.length === 0) return null;

  const n = vals.length;
  const suma = vals.reduce((a, b) => a + b, 0);
  const promedio = suma / n;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const varianza = vals.reduce((acc, v) => acc + Math.pow(v - promedio, 2), 0) / n;
  const de = Math.sqrt(varianza);

  return { promedio, min, max, de, n };
}

// Promedio del baño con muestras apareadas: para cada posición P_i completa en ambas
// muestras (la última s/baño y la última c/baño), se resta y se promedian las restas.
function calcularPromedioBano(muestras: MuestraPeso[]) {
  const sinBano = [...muestras].reverse().find((m) => m.tipo === "sandwich_sin_bano");
  const conBano = [...muestras].reverse().find((m) => m.tipo === "sandwich_con_bano");
  if (!sinBano || !conBano) return null;

  const restas: number[] = [];
  for (let i = 0; i < 12; i++) {
    const sin = parseFloat(sinBano.mediciones[i]);
    const con = parseFloat(conBano.mediciones[i]);
    if (!isNaN(sin) && !isNaN(con)) restas.push(con - sin);
  }
  if (restas.length === 0) return null;

  const promedio = restas.reduce((a, b) => a + b, 0) / restas.length;
  const varianza = restas.reduce((acc, v) => acc + Math.pow(v - promedio, 2), 0) / restas.length;
  return { promedio, de: Math.sqrt(varianza), n: restas.length, conBano };
}

function labelCampoExtra(campo: string): string {
  const labels: Record<string, string> = {
    peso_tapa: "Peso tapa (g)",
    penetrometria: "Penetrometría",
    temp_ambiente: "T° ambiente (°C)",
    temp_bano: "T° baño (°C)",
    escurrimiento: "Escurrimiento (g)",
  };
  return labels[campo] ?? campo;
}

// ─── Componente principal ────────────────────────────────────────────────────

// Wrapper sin hooks: elige la variante ANTES de montar el componente con estado,
// para no violar las reglas de hooks con un early-return.
export function PesoMedicionesForm(props: Props) {
  // "tapas" = slug del maestro de productos; "tapitas" = valor legacy del modo demo
  if (props.tipoFormulario === "peso_bano" && (props.familia === "tapas" || props.familia === "tapitas")) {
    return (
      <PesoBanoTapitasMode
        puntoControlId={props.puntoControlId}
        lineaProductivaId={props.lineaProductivaId}
        productoActivo={props.productoActivo}
      />
    );
  }
  return <PesoMedicionesFormStandard {...props} />;
}

function PesoMedicionesFormStandard({ puntoControlId, lineaProductivaId, tipoFormulario, productoActivo }: Props) {
  const router = useRouter();
  const { data: session } = useSession();

  const config = CONFIG[tipoFormulario];
  const tipoDefault = config.tipoOpciones[0].valor;

  const loteId = productoActivo.loteId;
  const [muestras, setMuestras] = useState<MuestraPeso[]>([crearMuestraVacia(1, tipoDefault)]);
  const [muestraActivaId, setMuestraActivaId] = useState(1);
  const [campoActivo, setCampoActivo] = useState<CampoNumpad | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const muestraActiva = muestras.find((m) => m.id === muestraActivaId)!;
  const muestraActivaIdx = muestras.findIndex((m) => m.id === muestraActivaId);

  const stats = useMemo(() => calcularStats(muestraActiva.mediciones), [muestraActiva.mediciones]);

  // Spec de calidad del peso medido (campo "mediciones"), si el producto la tiene
  // cargada para este punto de control — habilita la marca en vivo por celda.
  const specMediciones = specDeCampo(productoActivo.especificaciones, "mediciones");

  // Resumen de jornada — solo peso_bano: promedio del baño por muestras apareadas
  const resumenBano = useMemo(
    () => (tipoFormulario === "peso_bano" ? calcularPromedioBano(muestras) : null),
    [tipoFormulario, muestras]
  );

  // Valor actual en el numpad
  const valorNumpad: string = (() => {
    if (!campoActivo) return "";
    if (campoActivo.origen === "medicion") return muestraActiva.mediciones[campoActivo.idx];
    return muestraActiva[campoActivo.campo];
  })();

  const labelNumpad: string = (() => {
    if (!campoActivo) return "";
    if (campoActivo.origen === "medicion") return `P${campoActivo.idx + 1} (g)`;
    return labelCampoExtra(campoActivo.campo);
  })();

  // Actualizar muestra activa
  const updateMuestra = useCallback((patch: Partial<MuestraPeso>) => {
    setMuestras((prev) =>
      prev.map((m) => (m.id === muestraActivaId ? { ...m, ...patch } : m))
    );
  }, [muestraActivaId]);

  // Cambio desde numpad
  const onNumpadCambio = useCallback((v: string) => {
    if (!campoActivo) return;
    if (campoActivo.origen === "medicion") {
      const nuevas = [...muestraActiva.mediciones];
      nuevas[campoActivo.idx] = v;
      updateMuestra({ mediciones: nuevas });
    } else {
      updateMuestra({ [campoActivo.campo]: v });
    }
  }, [campoActivo, muestraActiva.mediciones, updateMuestra]);

  // OK en numpad: avanzar a siguiente celda o cerrar
  const onNumpadConfirmar = useCallback(() => {
    if (!campoActivo) return;
    if (campoActivo.origen === "medicion") {
      const siguiente = campoActivo.idx + 1;
      if (siguiente < 12) {
        setCampoActivo({ origen: "medicion", idx: siguiente });
      } else {
        setCampoActivo(null);
      }
    } else {
      setCampoActivo(null);
    }
  }, [campoActivo]);

  const agregarMuestra = () => {
    const nuevoId = Math.max(...muestras.map((m) => m.id)) + 1;
    const nueva = crearMuestraVacia(nuevoId, muestraActiva.tipo);
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

  // Construir payload data según tipoFormulario
  const construirData = (muestra: MuestraPeso): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      mediciones: muestra.mediciones.map((v) => (v !== "" ? parseFloat(v) : null)),
    };
    if (muestra.peso_tapa !== "") base.peso_tapa = parseFloat(muestra.peso_tapa);

    if (tipoFormulario === "peso_alfajor") {
      base.tipo = muestra.tipo;
    } else if (tipoFormulario === "peso_relleno") {
      base.tipo_relleno = muestra.tipo;
      if (muestra.tipo === "otros" && muestra.tipo_relleno_otro.trim()) base.tipo_relleno_otro = muestra.tipo_relleno_otro.trim();
      if (muestra.presencia_bob !== null) base.presencia_bob = muestra.presencia_bob;
      if (muestra.penetrometria !== "") base.penetrometria = parseFloat(muestra.penetrometria);
    } else if (tipoFormulario === "peso_bano") {
      base.tipo_producto = muestra.tipo;
      if (muestra.temp_ambiente !== "") base.temp_ambiente = parseFloat(muestra.temp_ambiente);
      if (muestra.temp_bano !== "") base.temp_bano = parseFloat(muestra.temp_bano);
      if (muestra.escurrimiento !== "") base.escurrimiento = parseFloat(muestra.escurrimiento);
    }
    return base;
  };

  const guardar = async () => {
    for (const muestra of muestras) {
      const vacias = muestra.mediciones.filter((v) => v === "").length;
      if (vacias > 0) {
        setError(`Muestra ${muestra.id}: faltan ${vacias} medición(es) de 12`);
        return;
      }
      if (tipoFormulario === "peso_bano") {
        if (!muestra.temp_ambiente) { setError(`Muestra ${muestra.id}: falta T° ambiente`); return; }
        if (!muestra.temp_bano) { setError(`Muestra ${muestra.id}: falta T° baño`); return; }
        if (!muestra.escurrimiento) { setError(`Muestra ${muestra.id}: falta escurrimiento`); return; }
      }
      if (tipoFormulario === "peso_relleno" && muestra.tipo === "otros" && !muestra.tipo_relleno_otro.trim()) {
        setError(`Muestra ${muestra.id}: aclará qué relleno es en el campo debajo de "Otros"`); return;
      }
    }

    const hoy = hoyPlanta();

    const registros = muestras.map((muestra, idx) => ({
      puntoControlId,
      loteId,
      lineaProductivaId,
      fecha: hoy,
      hora: muestra.hora + ":00",
      nroMuestra: idx + 1,
      notas: muestra.notas || undefined,
      data: construirData(muestra),
    }));

    setEnviando(true);
    setError(null);
    setCampoActivo(null);

    try {
      const res = await fetch("/api/v1/calidad/registros/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registros),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Error al guardar los registros."); return; }
      setExito(true);
      setTimeout(() => router.push(`/calidad/puntos-control?linea=${lineaProductivaId}`), 2000);
    } catch {
      setError("Error de conexión. Verificá la red e intentá nuevamente.");
    } finally {
      setEnviando(false);
    }
  };

  // ─── Pantalla de éxito ───────────────────────────────────────────────────

  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Jornada guardada</h2>
        <p className="text-gray-500 text-sm">Volviendo al módulo de Calidad...</p>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4" onClick={() => { if (campoActivo) setCampoActivo(null); }}>

      {/* Producto en producción */}
      <div onClick={(e) => e.stopPropagation()}>
        <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />
      </div>

      {/* Tabs de muestras */}
      <div className="bg-[#f0f0f0] rounded-xl p-3 flex items-center gap-2 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
        {muestras.map((m) => {
          const completadas = m.mediciones.filter((v) => v !== "").length;
          return (
            <div key={m.id} className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => { setMuestraActivaId(m.id); setCampoActivo(null); }}
                className={`
                  px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5
                  ${m.id === muestraActivaId
                    ? "bg-white text-[#E1000F] shadow border border-gray-200"
                    : "text-gray-600 hover:bg-white/60"
                  }
                `}
              >
                M{m.id}
                {completadas === 12 && (
                  <span className="text-green-500 text-xs">✓</span>
                )}
              </button>
              {muestras.length > 1 && m.id === muestraActivaId && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); eliminarMuestraActiva(); }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={agregarMuestra}
          className="flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-white/60 flex items-center gap-1 transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Muestra
        </button>
      </div>

      {/* Datos de la muestra: hora + tipo */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3" onClick={(e) => e.stopPropagation()}>
        {/* Operario */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="text-xs text-gray-500">Registrando como:</span>
          <span className="text-xs font-semibold text-gray-800">{session?.user?.name ?? "—"}</span>
        </div>

        {/* Hora */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Hora de muestra</label>
          <input
            type="time"
            value={muestraActiva.hora}
            onChange={(e) => updateMuestra({ hora: e.target.value })}
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none"
          />
        </div>

        {/* Tipo selector */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{config.tipoLabel}</p>
          <div className="flex flex-wrap gap-2">
            {config.tipoOpciones.map((op) => (
              <button
                key={op.valor}
                type="button"
                onClick={() => updateMuestra({ tipo: op.valor })}
                className={`
                  px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95
                  ${muestraActiva.tipo === op.valor
                    ? "bg-[#E1000F] text-white border-[#E1000F] shadow"
                    : "bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200"
                  }
                `}
              >
                {op.label}
              </button>
            ))}
          </div>
          {tipoFormulario === "peso_relleno" && muestraActiva.tipo === "otros" && (
            <input
              type="text"
              value={muestraActiva.tipo_relleno_otro}
              onChange={(e) => updateMuestra({ tipo_relleno_otro: e.target.value })}
              placeholder="Aclarar qué relleno es..."
              className="mt-2 w-full py-2.5 px-3 rounded-xl border-2 border-amber-300 bg-amber-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none"
            />
          )}
        </div>

        {/* Notas */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notas (opcional)</label>
          <textarea
            value={muestraActiva.notas}
            onChange={(e) => updateMuestra({ notas: e.target.value })}
            rows={2}
            placeholder="Observaciones de la muestra..."
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* Campos extra — solo peso_bano */}
      {tipoFormulario === "peso_bano" && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Condiciones del baño</p>
          <div className="grid grid-cols-2 gap-2">
            {(["peso_tapa", "temp_ambiente", "temp_bano", "escurrimiento"] as const).map((campo) => (
              <button
                key={campo}
                type="button"
                onClick={() => setCampoActivo({ origen: "extra", campo })}
                className={`
                  rounded-xl border-2 p-3 text-left transition-all active:scale-95
                  ${campoActivo?.origen === "extra" && campoActivo.campo === campo
                    ? "border-[#E1000F] bg-red-50"
                    : muestraActiva[campo] !== ""
                    ? "border-green-300 bg-green-50"
                    : "border-gray-200 bg-gray-50"
                  }
                `}
              >
                <p className="text-xs text-gray-500 mb-0.5">{labelCampoExtra(campo)}</p>
                <p className={`text-lg font-bold font-mono ${muestraActiva[campo] ? "text-gray-900" : "text-gray-300"}`}>
                  {muestraActiva[campo] || "—"}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Campos extra — solo peso_relleno */}
      {tipoFormulario === "peso_relleno" && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Datos adicionales</p>
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Presencia BOB (Bon o Bon)</p>
            <div className="flex gap-2">
              {([{ v: true, l: "Conforme" }, { v: false, l: "No conforme" }] as { v: boolean; l: string }[]).map(({ v, l }) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => updateMuestra({ presencia_bob: v })}
                  className={`
                    flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95
                    ${muestraActiva.presencia_bob === v
                      ? v ? "bg-green-500 text-white border-green-600 shadow" : "bg-red-600 text-white border-red-700 shadow"
                      : "bg-gray-100 text-gray-700 border-gray-200"
                    }
                  `}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Penetrometría (opcional)</p>
            <button
              type="button"
              onClick={() => setCampoActivo({ origen: "extra", campo: "penetrometria" })}
              className={`
                w-full rounded-xl border-2 p-3 text-left transition-all active:scale-95
                ${campoActivo?.origen === "extra" && campoActivo.campo === "penetrometria"
                  ? "border-[#E1000F] bg-red-50"
                  : muestraActiva.penetrometria !== ""
                  ? "border-green-300 bg-green-50"
                  : "border-gray-200 bg-gray-50"
                }
              `}
            >
              <p className="text-xs text-gray-500 mb-0.5">Valor penetrométrico</p>
              <p className={`text-xl font-bold font-mono ${muestraActiva.penetrometria ? "text-gray-900" : "text-gray-300"}`}>
                {muestraActiva.penetrometria || "Tocar para ingresar"}
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Grilla de mediciones 4×3 */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700">
            Mediciones — Muestra {muestraActiva.id}
            {/* Cada peso se compara contra la misma spec del producto (array_cada) */}
            {specMediciones && <span className="ml-2"><RangoObjetivo spec={specMediciones} /></span>}
          </h2>
          <span className="text-xs text-gray-400 font-medium">
            {muestraActiva.mediciones.filter((v) => v !== "").length}/12 completadas
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {muestraActiva.mediciones.map((val, idx) => {
            const isActivo = campoActivo?.origen === "medicion" && campoActivo.idx === idx;
            const tieneValor = val !== "";
            const valNum = tieneValor ? parseFloat(val) : null;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => setCampoActivo({ origen: "medicion", idx })}
                className={`
                  rounded-xl border-2 p-2 text-left transition-all active:scale-95 aspect-square flex flex-col justify-between
                  ${isActivo
                    ? "border-[#E1000F] bg-red-50 shadow-md"
                    : tieneValor
                    ? "border-green-300 bg-green-50"
                    : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                  }
                `}
              >
                <span className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-400">P{idx + 1}</span>
                  {specMediciones && <IndicadorSpec valor={valNum} spec={specMediciones} />}
                </span>
                <span className={`text-base font-bold font-mono leading-tight ${tieneValor ? "text-gray-900" : "text-gray-300"}`}>
                  {val || "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stats en vivo */}
      {stats && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Estadísticas — {stats.n}/12 mediciones
          </p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Promedio", valor: stats.promedio.toFixed(1) },
              { label: "Mínimo", valor: stats.min.toFixed(1) },
              { label: "Máximo", valor: stats.max.toFixed(1) },
              { label: "DE ±", valor: stats.de.toFixed(2) },
            ].map(({ label, valor }) => (
              <div key={label} className="bg-gray-50 rounded-xl p-2.5">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className="text-lg font-bold font-mono text-gray-800">{valor}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resumen de jornada — solo peso_bano */}
      {tipoFormulario === "peso_bano" && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Resumen de jornada</p>
          {resumenBano ? (
            <>
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 mb-3 text-center">
                <p className="text-xs text-indigo-500 font-semibold uppercase tracking-wide">Promedio del baño (c/baño − s/baño)</p>
                <p className="text-2xl font-bold font-mono text-indigo-800 mt-1">
                  {resumenBano.promedio.toFixed(1)} g
                  <span className="text-xs font-normal text-indigo-500 ml-2">DE ± {resumenBano.de.toFixed(2)} · {resumenBano.n} pares</span>
                </p>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: "Peso tapa", valor: resumenBano.conBano.peso_tapa || muestraActiva.peso_tapa || "—", unidad: "g" },
                  { label: "T° ambiente", valor: resumenBano.conBano.temp_ambiente || "—", unidad: "°C" },
                  { label: "T° baño", valor: resumenBano.conBano.temp_bano || "—", unidad: "°C" },
                  { label: "Escurrim.", valor: resumenBano.conBano.escurrimiento || "—", unidad: "g" },
                ].map(({ label, valor, unidad }) => (
                  <div key={label} className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                    <p className="text-sm font-bold font-mono text-gray-800">
                      {valor}{valor !== "—" && <span className="text-xs font-normal text-gray-400 ml-0.5">{unidad}</span>}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-3">
              Cargá una muestra <span className="font-semibold">Sandwich s/baño</span> y una <span className="font-semibold">Sandwich c/baño</span> para ver el promedio del baño.
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Registros ya cargados hoy */}
      <div onClick={(e) => e.stopPropagation()}>
        <RegistrosDelDia puntoControlId={puntoControlId} lineaProductivaId={lineaProductivaId} />
      </div>

      {/* Spacer para el botón fijo */}
      <div className="h-20" />

      {/* Numpad — stopPropagation para que el click no cierre el panel */}
      {campoActivo && (
        <div onClick={(e) => e.stopPropagation()}>
          <NumpadIndustrial
            valor={valorNumpad}
            onCambio={onNumpadCambio}
            onConfirmar={onNumpadConfirmar}
            label={labelNumpad}
            onCerrar={() => setCampoActivo(null)}
          />
        </div>
      )}

      {/* Botón guardar — sticky bottom */}
      {!campoActivo && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-20">
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={guardar}
              disabled={enviando}
              className="
                w-full py-4 rounded-2xl text-base font-bold text-white
                bg-[#E1000F] hover:bg-[#c0000d] active:scale-95
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all shadow-lg shadow-red-200
              "
            >
              {enviando ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Guardando...
                </span>
              ) : (
                `Guardar jornada — ${muestras.length} muestra${muestras.length !== 1 ? "s" : ""}`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modo Tapitas ────────────────────────────────────────────────────────────

type FilaTapita = "tapa" | "tapa_con_bano" | "bano";

type MuestraTapita = {
  id: number;
  hora: string;
  notas: string;
  mediciones_tapa: string[];
  mediciones_tapa_con_bano: string[];
  mediciones_bano: string[];
  temp_ambiente: string;
  temp_bano: string;
  escurrimiento: string;
};

type CampoTapita =
  | { origen: "medicion"; fila: FilaTapita; idx: number }
  | { origen: "extra"; campo: "temp_ambiente" | "temp_bano" | "escurrimiento" };

const FILAS_TAPITA: { key: FilaTapita; label: string; color: string; colorActivo: string; colorLleno: string }[] = [
  { key: "tapa", label: "TAPA", color: "bg-gray-50 border-gray-200", colorActivo: "border-[#E1000F] bg-red-50", colorLleno: "border-blue-300 bg-blue-50" },
  { key: "tapa_con_bano", label: "TAPA C/BAÑO", color: "bg-gray-50 border-gray-200", colorActivo: "border-[#E1000F] bg-red-50", colorLleno: "border-indigo-300 bg-indigo-50" },
  { key: "bano", label: "BAÑO", color: "bg-gray-50 border-gray-200", colorActivo: "border-[#E1000F] bg-red-50", colorLleno: "border-amber-300 bg-amber-50" },
];

function filaKey(fila: FilaTapita, m: MuestraTapita): string[] {
  if (fila === "tapa") return m.mediciones_tapa;
  if (fila === "tapa_con_bano") return m.mediciones_tapa_con_bano;
  return m.mediciones_bano;
}

function setFilaKey(fila: FilaTapita, m: MuestraTapita, vals: string[]): Partial<MuestraTapita> {
  if (fila === "tapa") return { mediciones_tapa: vals };
  if (fila === "tapa_con_bano") return { mediciones_tapa_con_bano: vals };
  return { mediciones_bano: vals };
}

function crearMuestraTapita(id: number): MuestraTapita {
  return {
    id,
    hora: horaPlanta(),
    notas: "",
    mediciones_tapa: Array(12).fill(""),
    mediciones_tapa_con_bano: Array(12).fill(""),
    mediciones_bano: Array(12).fill(""),
    temp_ambiente: "",
    temp_bano: "",
    escurrimiento: "",
  };
}

function PesoBanoTapitasMode({ puntoControlId, lineaProductivaId, productoActivo }: {
  puntoControlId: string; lineaProductivaId: string; productoActivo: ProductoActivoLinea;
}) {
  const router = useRouter();
  const { data: session } = useSession();

  const loteId = productoActivo.loteId;
  const [muestras, setMuestras] = useState<MuestraTapita[]>([crearMuestraTapita(1)]);
  const [muestraActivaId, setMuestraActivaId] = useState(1);
  const [campoActivo, setCampoActivo] = useState<CampoTapita | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const muestraActiva = muestras.find((m) => m.id === muestraActivaId)!;
  const muestraActivaIdx = muestras.findIndex((m) => m.id === muestraActivaId);

  const statsPorFila = useMemo(() => {
    return {
      tapa: calcularStats(muestraActiva.mediciones_tapa),
      tapa_con_bano: calcularStats(muestraActiva.mediciones_tapa_con_bano),
      bano: calcularStats(muestraActiva.mediciones_bano),
    };
  }, [muestraActiva.mediciones_tapa, muestraActiva.mediciones_tapa_con_bano, muestraActiva.mediciones_bano]);

  const updateMuestra = useCallback((patch: Partial<MuestraTapita>) => {
    setMuestras((prev) => prev.map((m) => m.id === muestraActivaId ? { ...m, ...patch } : m));
  }, [muestraActivaId]);

  const valorNumpad: string = (() => {
    if (!campoActivo) return "";
    if (campoActivo.origen === "medicion") return filaKey(campoActivo.fila, muestraActiva)[campoActivo.idx];
    return muestraActiva[campoActivo.campo];
  })();

  const labelNumpad: string = (() => {
    if (!campoActivo) return "";
    if (campoActivo.origen === "medicion") {
      const filaLabel = FILAS_TAPITA.find((f) => f.key === campoActivo.fila)?.label ?? "";
      return `${filaLabel} — P${campoActivo.idx + 1} (g)`;
    }
    return labelCampoExtra(campoActivo.campo);
  })();

  const onNumpadCambio = useCallback((v: string) => {
    if (!campoActivo) return;
    if (campoActivo.origen === "medicion") {
      const vals = [...filaKey(campoActivo.fila, muestraActiva)];
      vals[campoActivo.idx] = v;
      updateMuestra(setFilaKey(campoActivo.fila, muestraActiva, vals));
    } else {
      updateMuestra({ [campoActivo.campo]: v });
    }
  }, [campoActivo, muestraActiva, updateMuestra]);

  // Auto-avance: TAPA P1→P12 → TAPA C/BAÑO P1→P12 → BAÑO P1→P12 → cerrar
  const onNumpadConfirmar = useCallback(() => {
    if (!campoActivo) return;
    if (campoActivo.origen === "extra") { setCampoActivo(null); return; }

    const siguiente = campoActivo.idx + 1;
    if (siguiente < 12) {
      setCampoActivo({ origen: "medicion", fila: campoActivo.fila, idx: siguiente });
      return;
    }
    // Avanzar a siguiente fila
    const filaIdx = FILAS_TAPITA.findIndex((f) => f.key === campoActivo.fila);
    if (filaIdx < FILAS_TAPITA.length - 1) {
      setCampoActivo({ origen: "medicion", fila: FILAS_TAPITA[filaIdx + 1].key, idx: 0 });
    } else {
      setCampoActivo(null);
    }
  }, [campoActivo]);

  const agregarMuestra = () => {
    const nuevoId = Math.max(...muestras.map((m) => m.id)) + 1;
    setMuestras((prev) => [...prev, crearMuestraTapita(nuevoId)]);
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

  const guardar = async () => {
    for (const m of muestras) {
      for (const fila of FILAS_TAPITA) {
        const vacias = filaKey(fila.key, m).filter((v) => v === "").length;
        if (vacias > 0) { setError(`M${m.id} — ${fila.label}: faltan ${vacias} medición(es)`); return; }
      }
      if (!m.temp_ambiente) { setError(`M${m.id}: falta T° ambiente`); return; }
      if (!m.temp_bano) { setError(`M${m.id}: falta T° baño`); return; }
      if (!m.escurrimiento) { setError(`M${m.id}: falta escurrimiento`); return; }
    }

    const hoy = hoyPlanta();
    const registros = muestras.map((m, idx) => ({
      puntoControlId, loteId, lineaProductivaId,
      fecha: hoy, hora: m.hora + ":00", nroMuestra: idx + 1,
      notas: m.notas || undefined,
      data: {
        familia: "tapitas",
        mediciones_tapa: m.mediciones_tapa.map(parseFloat),
        mediciones_tapa_con_bano: m.mediciones_tapa_con_bano.map(parseFloat),
        mediciones_bano: m.mediciones_bano.map(parseFloat),
        temp_ambiente: parseFloat(m.temp_ambiente),
        temp_bano: parseFloat(m.temp_bano),
        escurrimiento: parseFloat(m.escurrimiento),
      },
    }));

    setEnviando(true); setError(null); setCampoActivo(null);
    try {
      const res = await fetch("/api/v1/calidad/registros/batch", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(registros),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Error al guardar."); return; }
      setExito(true);
      setTimeout(() => router.push(`/calidad/puntos-control?linea=${lineaProductivaId}`), 2000);
    } catch {
      setError("Error de conexión. Verificá la red e intentá nuevamente.");
    } finally {
      setEnviando(false);
    }
  };

  if (exito) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900">Jornada guardada</h2>
      <p className="text-gray-500 text-sm">Volviendo a Puntos de Control...</p>
    </div>
  );

  const completadasTotal = FILAS_TAPITA.reduce(
    (acc, f) => acc + filaKey(f.key, muestraActiva).filter((v) => v !== "").length, 0
  );

  return (
    <div className="space-y-4" onClick={() => { if (campoActivo) setCampoActivo(null); }}>

      {/* Badge Tapitas */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <span className="text-indigo-700 text-sm font-bold">T</span>
        </div>
        <div>
          <p className="text-sm font-bold text-indigo-800">Control de Peso Baño — Tapitas</p>
          <p className="text-xs text-indigo-600">3 mediciones por muestra: TAPA · TAPA C/BAÑO · BAÑO</p>
        </div>
      </div>

      {/* Producto en producción */}
      <div onClick={(e) => e.stopPropagation()}>
        <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />
      </div>

      {/* Tabs de muestras */}
      <div className="bg-[#f0f0f0] rounded-xl p-3 flex items-center gap-2 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
        {muestras.map((m, idx) => {
          const completas = FILAS_TAPITA.reduce((acc, f) => acc + filaKey(f.key, m).filter((v) => v !== "").length, 0);
          return (
            <div key={m.id} className="relative flex-shrink-0">
              <button type="button" onClick={() => { setMuestraActivaId(m.id); setCampoActivo(null); }}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 ${m.id === muestraActivaId ? "bg-white text-[#E1000F] shadow border border-gray-200" : "text-gray-600 hover:bg-white/60"}`}>
                M{m.id} {completas === 36 && <span className="text-green-500 text-xs">✓</span>}
              </button>
              {muestras.length > 1 && m.id === muestraActivaId && (
                <button type="button" onClick={(e) => { e.stopPropagation(); eliminarMuestraActiva(); }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">×</button>
              )}
            </div>
          );
        })}
        <button type="button" onClick={agregarMuestra}
          className="flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-white/60 flex items-center gap-1 transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Muestra
        </button>
      </div>

      {/* Hora + operario */}
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
      </div>

      {/* Condiciones del baño */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Condiciones del baño</p>
        <div className="grid grid-cols-3 gap-2">
          {(["temp_ambiente", "temp_bano", "escurrimiento"] as const).map((campo) => {
            const activo = campoActivo?.origen === "extra" && (campoActivo as { origen: "extra"; campo: string }).campo === campo;
            return (
              <button key={campo} type="button" onClick={() => setCampoActivo({ origen: "extra", campo })}
                className={`rounded-xl border-2 p-3 text-left transition-all active:scale-95 ${activo ? "border-[#E1000F] bg-red-50" : muestraActiva[campo] !== "" ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
                <p className="text-xs text-gray-500 mb-0.5">{labelCampoExtra(campo)}</p>
                <p className={`text-lg font-bold font-mono ${muestraActiva[campo] ? "text-gray-900" : "text-gray-300"}`}>{muestraActiva[campo] || "—"}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grillas de mediciones — 3 filas */}
      {FILAS_TAPITA.map((fila) => {
        const vals = filaKey(fila.key, muestraActiva);
        const stats = statsPorFila[fila.key];
        const completadas = vals.filter((v) => v !== "").length;

        return (
          <div key={fila.key} className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-700">{fila.label}</h2>
              <span className="text-xs text-gray-400 font-medium">{completadas}/12</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {vals.map((val, idx) => {
                const isActivo = campoActivo?.origen === "medicion" &&
                  (campoActivo as { origen: "medicion"; fila: FilaTapita; idx: number }).fila === fila.key &&
                  (campoActivo as { origen: "medicion"; fila: FilaTapita; idx: number }).idx === idx;
                const tieneValor = val !== "";
                return (
                  <button key={idx} type="button"
                    onClick={() => setCampoActivo({ origen: "medicion", fila: fila.key, idx })}
                    className={`rounded-xl border-2 p-2 text-left transition-all active:scale-95 aspect-square flex flex-col justify-between ${isActivo ? fila.colorActivo + " shadow-md" : tieneValor ? fila.colorLleno : fila.color + " hover:bg-gray-100"}`}>
                    <span className="text-xs font-bold text-gray-400">P{idx + 1}</span>
                    <span className={`text-base font-bold font-mono leading-tight ${tieneValor ? "text-gray-900" : "text-gray-300"}`}>{val || "—"}</span>
                  </button>
                );
              })}
            </div>
            {stats && (
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                {[
                  { label: "Prom.", valor: stats.promedio.toFixed(1) },
                  { label: "Mín.", valor: stats.min.toFixed(1) },
                  { label: "Máx.", valor: stats.max.toFixed(1) },
                  { label: "DE ±", valor: stats.de.toFixed(2) },
                ].map(({ label, valor }) => (
                  <div key={label} className="bg-gray-50 rounded-xl p-2">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-sm font-bold font-mono text-gray-800">{valor}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Notas */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100" onClick={(e) => e.stopPropagation()}>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notas (opcional)</label>
        <textarea value={muestraActiva.notas} onChange={(e) => updateMuestra({ notas: e.target.value })} rows={2}
          placeholder="Observaciones de la muestra..."
          className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

      {/* Registros ya cargados hoy */}
      <div onClick={(e) => e.stopPropagation()}>
        <RegistrosDelDia puntoControlId={puntoControlId} lineaProductivaId={lineaProductivaId} />
      </div>

      <div className="h-20" />

      {campoActivo && (
        <div onClick={(e) => e.stopPropagation()}>
          <NumpadIndustrial valor={valorNumpad} onCambio={onNumpadCambio} onConfirmar={onNumpadConfirmar} label={labelNumpad} onCerrar={() => setCampoActivo(null)} />
        </div>
      )}

      {!campoActivo && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-20">
          <div className="max-w-2xl mx-auto">
            <button type="button" onClick={guardar} disabled={enviando}
              className="w-full py-4 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200">
              {enviando ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Guardando...
                </span>
              ) : `Guardar — ${completadasTotal}/36 mediciones · ${muestras.length} muestra${muestras.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
