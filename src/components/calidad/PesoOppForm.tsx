"use client";

// Captura del "Control Peso Alfajor + OPP".
//
// Una muestra = una hora = un registro: 10 pesos brutos del alfajor ya envuelto
// en film OPP, más la verificación del fechado de esos mismos 10 paquetes.
//
// Es control de PROCESO (ajuste de la envolvedora), no verificación de contenido
// neto legal — el peso incluye la tara del film. Ver el comentario del schema.
//
// El fechado no es un booleano a propósito: 1 de 10 ilegible (ajustar
// codificador) y 10 de 10 con fecha incorrecta (retención masiva) son eventos de
// costo muy distinto, y hace falta el tipo de falla para dimensionar la
// retención desde la última verificación conforme.

import { useState } from "react";
import { useSession } from "next-auth/react";
import { NumpadIndustrial } from "@/components/calidad/NumpadIndustrial";
import { ProductoActivoBanner } from "@/components/calidad/ProductoActivoBanner";
import { RegistrosDelDia, useRegistrosDelDia } from "@/components/calidad/RegistrosDelDia";
import { RangoObjetivo, IndicadorSpec, specDeCampo } from "@/components/calidad/IndicadorSpec";
import { useBatchGuardar } from "@/hooks/useBatchGuardar";
import { usePersistedState } from "@/hooks/usePersistedState";
import { claveProgresoMuestras } from "@/lib/calidad/persistencia-key";
import { hoyPlanta, horaPlanta } from "@/lib/calidad/fecha-planta";
import { estadisticasMediciones } from "@/lib/calidad/mediciones-stats";
import type { ProductoActivoLinea } from "@/types/calidad";

type Props = {
  puntoControlId: string;
  lineaProductivaId: string;
  productoActivo: ProductoActivoLinea;
};

const CANTIDAD_PAQUETES = 10;

// Espejan mediciones.{minimum,maximum,multipleOf} de peso-opp.schema.ts. Si se
// cambian allá, cambiarlos acá — hay un test que lo verifica.
//
// Sin este espejo, un peso de 2 decimales (47.35, plausible con balanza de
// 0,01 g) o fuera de rango pasa la validación del form y el server lo rechaza
// con "1 registro(s) con datos inválidos", sobre 10 celdas en verde y sin decir
// qué celda: el modo de falla "0 registros guardados" de ADR-016.
const PESO_MIN = 10;
const PESO_MAX = 500;
const PESO_DECIMALES = 1;

type TipoFalla = "ausente" | "ilegible" | "fecha_incorrecta" | "lote_incorrecto";

// La ayuda va como subtítulo VISIBLE de cada chip, no en un `title`: en tablet no
// hay hover, así que un title es información que nadie va a leer nunca. Y la
// diferencia importa: "ilegible" se resuelve ajustando el codificador, mientras
// que fecha o lote incorrectos implican retención masiva y escalamiento.
const TIPOS_FALLA: { key: TipoFalla; label: string; ayuda: string; grave: boolean }[] = [
  { key: "ilegible", label: "Ilegible", ayuda: "Borroso — ajustar codificador", grave: false },
  { key: "ausente", label: "Ausente", ayuda: "Salió sin fechado", grave: false },
  { key: "fecha_incorrecta", label: "Fecha incorrecta", ayuda: "Retención masiva — escalar", grave: true },
  { key: "lote_incorrecto", label: "Lote incorrecto", ayuda: "Retención masiva — escalar", grave: true },
];

function labelTipoFalla(key: unknown): string {
  return TIPOS_FALLA.find((t) => t.key === key)?.label ?? String(key);
}

type MuestraForm = {
  id: number;
  hora: string;
  notas: string;
  mediciones: string[];
  fechadoNoConformes: string;
  fechadoTipoFalla: TipoFalla | null;
  fechadoObservacion: string;
};

// `estabaVacia` se captura al ABRIR la celda: distingue "carga secuencial" (la
// celda estaba vacía → conviene auto-avanzar) de "corrección" (ya tenía valor →
// hay que cerrar, no saltar a otra celda cargada).
type Foco = { muestraId: number; celda: number | "no_conformes"; estabaVacia: boolean };

function crearMuestraVacia(id: number): MuestraForm {
  return {
    id,
    hora: horaPlanta(),
    notas: "",
    mediciones: Array.from({ length: CANTIDAD_PAQUETES }, () => ""),
    fechadoNoConformes: "",
    fechadoTipoFalla: null,
    fechadoObservacion: "",
  };
}

function noConformesNum(m: MuestraForm): number {
  if (m.fechadoNoConformes === "") return 0;
  const n = parseInt(m.fechadoNoConformes, 10);
  return Number.isFinite(n) ? n : 0;
}

export function PesoOppForm({ puntoControlId, lineaProductivaId, productoActivo }: Props) {
  const { data: session } = useSession();
  const loteId = productoActivo.loteId;

  const claveProgreso = claveProgresoMuestras({ lineaProductivaId, loteId, puntoControlId });
  const [muestras, setMuestras, limpiarProgreso] = usePersistedState<MuestraForm[]>(claveProgreso, () => [
    crearMuestraVacia(1),
  ]);

  const [refreshKey, setRefreshKey] = useState(0);
  const { registros, cargando, esDemo, error: errorRegistros, recargar } = useRegistrosDelDia(
    puntoControlId,
    lineaProductivaId,
    refreshKey
  );

  // Vuelve a los puntos de control de la línea, no a la raíz de Calidad (mismo
  // criterio que PesoMedicionesForm): el operario carga varios controles seguidos.
  const { enviando, error, exito, guardar } = useBatchGuardar(
    `/calidad/puntos-control?linea=${lineaProductivaId}`,
    () => {
      limpiarProgreso();
      setRefreshKey((k) => k + 1);
    }
  );

  const [foco, setFoco] = useState<Foco | null>(null);
  const [validar, setValidar] = useState(false);

  const specPeso = specDeCampo(productoActivo.especificaciones, "mediciones");

  // ── Agregado del lote (ponderado) ────────────────────────────────────────
  //
  // Mismo criterio que RoturaEncajadoForm: filtrado por lote activo (no por
  // fecha) porque useRegistrosDelDia trae todo (línea, punto de control, hoy),
  // y un cambio de producto a mitad de jornada mezclaría el promedio de dos
  // productos distintos bajo la spec del que está activo ahora.
  const pesosGuardados: number[] = registros
    .filter((r) => r.lote?.numeroLote === productoActivo.numeroLote)
    .flatMap((r) => (Array.isArray(r.data.mediciones) ? (r.data.mediciones as unknown[]) : []))
    .map((v) => (typeof v === "number" ? v : NaN));

  const pesosEnPantalla: string[] = muestras.flatMap((m) => m.mediciones);

  const agregado = estadisticasMediciones([...pesosGuardados, ...pesosEnPantalla]);
  const cantidadMuestrasLote =
    registros.filter((r) => r.lote?.numeroLote === productoActivo.numeroLote).length + muestras.length;

  // Igual que Rotura: si no se pudo traer lo ya cargado hoy, el agregado solo
  // tiene lo de pantalla — no es "el lote". Mostrarlo igual sería señalizar
  // conformidad sobre un denominador incompleto.
  const agregadoIncompleto = cargando || errorRegistros != null;

  // ── Mutadores ─────────────────────────────────────────────────────────────

  const patchMuestra = (muestraId: number, patch: Partial<MuestraForm>) =>
    setMuestras((prev) => prev.map((m) => (m.id === muestraId ? { ...m, ...patch } : m)));

  const setMedicion = (muestraId: number, celda: number, valor: string) =>
    setMuestras((prev) =>
      prev.map((m) => {
        if (m.id !== muestraId) return m;
        const mediciones = [...m.mediciones];
        mediciones[celda] = valor;
        return { ...m, mediciones };
      })
    );

  const setNoConformes = (muestraId: number, valor: string) => {
    const entero = valor.replace(".", "");
    setMuestras((prev) =>
      prev.map((m) => {
        if (m.id !== muestraId) return m;
        const n = entero === "" ? 0 : parseInt(entero, 10);
        // Al volver a 0 se resetea el tipo de falla: si quedara colgado, se
        // guardaría un tipo de falla sobre una muestra conforme y el dato
        // quedaría contaminado.
        const limpiar = !Number.isFinite(n) || n === 0;
        return {
          ...m,
          fechadoNoConformes: entero,
          fechadoTipoFalla: limpiar ? null : m.fechadoTipoFalla,
          fechadoObservacion: limpiar ? "" : m.fechadoObservacion,
        };
      })
    );
  };

  const valorDeFoco = (f: Foco): string => {
    const m = muestras.find((x) => x.id === f.muestraId);
    if (!m) return "";
    return f.celda === "no_conformes" ? m.fechadoNoConformes : m.mediciones[f.celda];
  };

  const onCambioFoco = (f: Foco, v: string) => {
    if (f.celda === "no_conformes") setNoConformes(f.muestraId, v);
    else setMedicion(f.muestraId, f.celda, v);
  };

  // Auto-avance al confirmar una celda de peso.
  //
  // Solo avanza si la celda que se estaba cargando estaba VACÍA (carga secuencial
  // normal). Si el operario volvió a una celda ya cargada para corregirla, se
  // cierra el numpad en vez de saltar: saltar a la celda siguiente —que también
  // tiene valor— hacía que el próximo dígito la corrompiera en silencio.
  //
  // Y avanza a la siguiente celda VACÍA, no a la de al lado, para no pisar lo ya
  // cargado cuando se completó una celda salteada.
  const confirmarFoco = () => {
    if (!foco || foco.celda === "no_conformes") {
      setFoco(null);
      return;
    }
    const muestra = muestras.find((m) => m.id === foco.muestraId);
    if (!muestra || !foco.estabaVacia) {
      setFoco(null);
      return;
    }
    const celdaActual = foco.celda;
    const siguiente = muestra.mediciones.findIndex((v, i) => i > celdaActual && v === "");
    if (siguiente === -1) setFoco(null);
    else setFoco({ muestraId: foco.muestraId, celda: siguiente, estabaVacia: true });
  };

  const agregarMuestra = () =>
    setMuestras((prev) => [...prev, crearMuestraVacia(Math.max(0, ...prev.map((m) => m.id)) + 1)]);

  const quitarMuestra = (muestraId: number, hora: string) => {
    if (muestras.length === 1) return;
    if (!window.confirm(`Vas a eliminar la muestra de las ${hora} con lo que tenga cargado. ¿Confirmás?`)) return;
    setMuestras((prev) => prev.filter((m) => m.id !== muestraId));
  };

  // ── Validación ────────────────────────────────────────────────────────────

  const problema = (): string | null => {
    for (const m of muestras) {
      const faltantes = m.mediciones.filter((v) => v === "").length;
      if (faltantes > 0) {
        return `Hora ${m.hora}: faltan ${faltantes} de los ${CANTIDAD_PAQUETES} pesos.`;
      }
      if (m.mediciones.some((v) => !Number.isFinite(parseFloat(v)))) {
        return `Hora ${m.hora}: hay un peso que no es un número válido.`;
      }
      // Cotas del schema espejadas acá para poder señalar la celda exacta. El
      // server las revalida igual; esto existe para que el error sea accionable.
      for (const [i, v] of m.mediciones.entries()) {
        const n = parseFloat(v);
        if (n < PESO_MIN || n > PESO_MAX) {
          return `Hora ${m.hora}, paquete ${i + 1}: ${n} g está fuera del rango registrable (${PESO_MIN}–${PESO_MAX} g). Revisá la balanza o el valor tipeado.`;
        }
        const decimales = (v.split(".")[1] ?? "").length;
        if (decimales > PESO_DECIMALES) {
          return `Hora ${m.hora}, paquete ${i + 1}: se registra ${PESO_DECIMALES} decimal (${n.toFixed(
            PESO_DECIMALES
          )}), no ${decimales}.`;
        }
      }
      if (m.fechadoNoConformes === "") {
        return `Hora ${m.hora}: indicá cuántos paquetes tuvieron fechado no conforme (0 si todos están bien).`;
      }
      const nc = noConformesNum(m);
      if (nc > CANTIDAD_PAQUETES) {
        return `Hora ${m.hora}: los no conformes (${nc}) no pueden superar los ${CANTIDAD_PAQUETES} paquetes.`;
      }
      if (nc > 0 && !m.fechadoTipoFalla) {
        return `Hora ${m.hora}: elegí el tipo de falla de fechado.`;
      }
    }
    return null;
  };

  // ── Guardado ──────────────────────────────────────────────────────────────

  const onGuardar = async () => {
    setValidar(true);
    if (problema()) return;

    if (
      !window.confirm(
        `Vas a guardar ${muestras.length} ${
          muestras.length === 1 ? "muestra" : "muestras"
        } y salir de este punto de control. ¿Confirmás?`
      )
    ) {
      return;
    }

    const hoy = hoyPlanta();

    const registrosBatch = muestras.map((m, idx) => {
      const nc = noConformesNum(m);
      const data: Record<string, unknown> = {
        mediciones: m.mediciones.map((v) => parseFloat(v)),
        fechado_no_conformes: nc,
      };
      // Cuando no hay no conformes la clave se OMITE (no se manda null: el type
      // del schema es string y AJV rechazaría null, dando 0 registros guardados).
      if (nc > 0 && m.fechadoTipoFalla) data.fechado_tipo_falla = m.fechadoTipoFalla;
      if (m.fechadoObservacion.trim()) data.fechado_observacion = m.fechadoObservacion.trim();

      return {
        puntoControlId,
        loteId,
        lineaProductivaId,
        // responsableId se inyecta server-side desde la sesión
        fecha: hoy,
        hora: m.hora + ":00",
        nroMuestra: idx + 1,
        notas: m.notas.trim() || undefined,
        data,
      };
    });

    await guardar(registrosBatch);
  };

  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Control de peso guardado</h2>
        <p className="text-gray-500 text-sm">Volviendo al módulo de Calidad...</p>
      </div>
    );
  }

  const errValidacion = validar ? problema() : null;

  return (
    <div className="space-y-4">
      {/* Contexto */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
        <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="text-xs text-gray-500">Registrando como:</span>
          <span className="text-xs font-semibold text-gray-800">{session?.user?.name ?? "—"}</span>
        </div>
        <p className="text-xs text-gray-600">
          Peso bruto del paquete envuelto (incluye film OPP) — control de proceso. El fechado se verifica
          sobre los mismos {CANTIDAD_PAQUETES} paquetes.
        </p>
      </div>

      {/* Resumen ponderado del lote */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Peso promedio del lote</h2>
          {!agregadoIncompleto && (
            <span className="text-xs text-gray-600">
              {cantidadMuestrasLote} {cantidadMuestrasLote === 1 ? "muestra" : "muestras"}
              {agregado ? ` · ${agregado.n} paquetes` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <p className="text-2xl font-bold font-mono text-gray-900">
            {agregadoIncompleto || !agregado ? "—" : `${agregado.promedio.toFixed(1)} g`}
          </p>
          {/* Sin indicador de spec si el agregado está incompleto o vacío: sería
              señalizar conformidad sobre un denominador parcial. */}
          {specPeso && agregado && !agregadoIncompleto && (
            <IndicadorSpec valor={agregado.promedio} spec={specPeso} conTexto />
          )}
        </div>
        {specPeso && <RangoObjetivo spec={specPeso} />}
        {agregadoIncompleto ? (
          <p className="text-xs text-gray-600 mt-2">
            {cargando
              ? "Cargando los registros de hoy..."
              : "No se pudo traer lo ya cargado hoy — el promedio del lote está incompleto. Podés seguir cargando igual."}
          </p>
        ) : (
          !specPeso && (
            <p className="text-xs text-gray-600 mt-2">
              Sin tolerancia cargada para este producto: el promedio se registra igual, pero no se compara
              contra nada. Se define en Maestro → Especificaciones.
            </p>
          )
        )}
      </div>

      {muestras.map((muestra, idx) => {
        const stats = estadisticasMediciones(muestra.mediciones);
        const nc = noConformesNum(muestra);

        return (
          <div key={muestra.id} className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                  Muestra {idx + 1}
                </span>
                <input
                  type="time"
                  value={muestra.hora}
                  onChange={(e) => patchMuestra(muestra.id, { hora: e.target.value })}
                  className="py-1.5 px-2 rounded-lg border-2 border-gray-200 bg-gray-50 text-sm font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none"
                />
              </div>
              {muestras.length > 1 && (
                <button
                  type="button"
                  onClick={() => quitarMuestra(muestra.id, muestra.hora)}
                  className="px-3 py-2.5 rounded-lg text-xs font-semibold text-gray-600 hover:text-[#E1000F]"
                >
                  Eliminar
                </button>
              )}
            </div>

            {/* Pesos */}
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  Peso de {CANTIDAD_PAQUETES} paquetes (g)
                </p>
                {specPeso && <RangoObjetivo spec={specPeso} />}
              </div>

              {/* Promedio de ESTA muestra, ANTES de la grilla de carga: el operario
                  tiene que ver hacia dónde va el promedio mientras carga, no
                  recién al final cuando ya no puede reaccionar sobre esa muestra. */}
              {stats && (
                <div className="mb-2 flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                    n={stats.n} · mín {stats.min.toFixed(1)} · máx {stats.max.toFixed(1)} · σ{" "}
                    {stats.desvio.toFixed(2)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-bold font-mono text-gray-900">
                      Prom. {stats.promedio.toFixed(1)} g
                    </span>
                    {specPeso && <IndicadorSpec valor={stats.promedio} spec={specPeso} conTexto />}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-5 gap-2">
                {muestra.mediciones.map((valor, celda) => {
                  const activo = foco?.muestraId === muestra.id && foco.celda === celda;
                  const num = valor === "" ? null : parseFloat(valor);
                  return (
                    <button
                      key={celda}
                      type="button"
                      onClick={() => setFoco({ muestraId: muestra.id, celda, estabaVacia: valor === "" })}
                      aria-label={`Peso paquete ${celda + 1} de ${CANTIDAD_PAQUETES}${
                        valor !== "" ? `, ${valor} gramos` : ", sin cargar"
                      }`}
                      className={`rounded-xl border-2 py-2 px-1 transition-all active:scale-95 ${
                        activo
                          ? "border-[#E1000F] bg-red-50"
                          : valor !== ""
                          ? "border-green-300 bg-green-50"
                          : "border-gray-200 bg-gray-50"
                      }`}
                    >
                      <span className="block text-[11px] font-semibold text-gray-600">{celda + 1}</span>
                      <span
                        className={`block text-base font-bold font-mono ${
                          valor !== "" ? "text-gray-900" : "text-gray-300"
                        }`}
                      >
                        {valor || "—"}
                      </span>
                      {specPeso && num != null && (
                        <span className="block mt-0.5">
                          <IndicadorSpec valor={num} spec={specPeso} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fechado */}
            <div className="rounded-xl border-2 border-gray-200 p-3 space-y-3">
              <p className="text-sm font-bold text-gray-800">Fechado de paquetes</p>
              {/* Permanente, también con 0 no conformes: el operario tiene que
                  conocer la consecuencia ANTES de decidir el número, no después. */}
              <p className="text-xs text-gray-700">
                Si hay fechado no conforme corresponde retener lo producido desde la última verificación
                conforme.
              </p>
              <div>
                <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Paquetes no conformes (de {CANTIDAD_PAQUETES})
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setFoco({
                      muestraId: muestra.id,
                      celda: "no_conformes",
                      estabaVacia: muestra.fechadoNoConformes === "",
                    })
                  }
                  className={`w-full rounded-xl border-2 py-2 transition-all active:scale-95 ${
                    foco?.muestraId === muestra.id && foco.celda === "no_conformes"
                      ? "border-[#E1000F] bg-red-50"
                      : muestra.fechadoNoConformes === ""
                      ? "border-gray-200 bg-gray-50"
                      : nc > 0
                      ? "border-red-300 bg-red-50"
                      : "border-green-300 bg-green-50"
                  }`}
                >
                  <span
                    className={`text-2xl font-bold font-mono ${
                      muestra.fechadoNoConformes !== "" ? "text-gray-900" : "text-gray-300"
                    }`}
                  >
                    {muestra.fechadoNoConformes || "—"}
                  </span>
                </button>
              </div>

              {/* El tipo de falla solo aplica si hay no conformes. El schema lo
                  exige con if/then; acá se pide en la UI. */}
              {nc > 0 && (
                <>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      Tipo de falla <span className="text-red-500">*</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {TIPOS_FALLA.map(({ key, label, ayuda, grave }) => {
                        const activo = muestra.fechadoTipoFalla === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={activo}
                            onClick={() => patchMuestra(muestra.id, { fechadoTipoFalla: key })}
                            className={`px-3 py-3 rounded-xl border-2 text-left transition-all active:scale-95 ${
                              activo
                                ? grave
                                  ? "bg-red-600 text-white border-red-700 shadow"
                                  : "bg-amber-500 text-white border-amber-600 shadow"
                                : "bg-gray-100 text-gray-700 border-gray-200"
                            }`}
                          >
                            <span className="block text-xs font-bold">{label}</span>
                            <span
                              className={`block text-[11px] mt-0.5 ${
                                activo ? "text-white/85" : grave ? "text-red-700" : "text-gray-600"
                              }`}
                            >
                              {ayuda}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3">
                    <p className="text-xs font-semibold text-amber-800 mb-1.5">
                      Fechado no conforme: corresponde retener lo producido desde la última verificación
                      conforme.
                    </p>
                    <textarea
                      value={muestra.fechadoObservacion}
                      onChange={(e) => patchMuestra(muestra.id, { fechadoObservacion: e.target.value })}
                      rows={2}
                      maxLength={300}
                      placeholder="Qué se leyó, a quién se avisó, alcance de la retención..."
                      className="w-full py-2 px-3 rounded-xl border-2 border-amber-300 bg-white text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Notas de la muestra (opcional)
              </label>
              <input
                type="text"
                value={muestra.notas}
                onChange={(e) => patchMuestra(muestra.id, { notas: e.target.value })}
                // Zod corta notas en 1000: sin este tope, 1001 caracteres rechazan
                // el batch COMPLETO y se pierden las 10 celdas ya cargadas.
                maxLength={1000}
                className="w-full py-2 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none"
              />
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={agregarMuestra}
        className="w-full py-3 rounded-2xl border-2 border-dashed border-gray-300 text-sm font-bold text-gray-500 hover:border-[#E1000F] hover:text-[#E1000F] transition-all active:scale-95"
      >
        + Agregar hora
      </button>

      <RegistrosDelDia
        puntoControlId={puntoControlId}
        lineaProductivaId={lineaProductivaId}
        registros={registros}
        cargando={cargando}
        esDemo={esDemo}
        error={errorRegistros}
        onReintentar={recargar}
        renderItem={(r) => {
          const meds = Array.isArray(r.data.mediciones) ? (r.data.mediciones as unknown[]) : [];
          const stats = estadisticasMediciones(meds.map((v) => (typeof v === "number" ? v : null)));
          const noConf = Number(r.data.fechado_no_conformes ?? 0);
          return (
            <div className="flex items-start gap-3">
              <span className="text-xs font-mono font-semibold text-gray-500 bg-gray-100 rounded-lg px-2 py-1 shrink-0">
                {r.hora?.slice(0, 5) ?? "—"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800">
                  Prom. {stats ? `${stats.promedio.toFixed(1)} g` : "—"} · n={stats?.n ?? 0}
                  {noConf > 0 ? (
                    <span className="text-[#E1000F] font-semibold">
                      {" "}
                      · fechado {noConf}/{CANTIDAD_PAQUETES} NC
                      {r.data.fechado_tipo_falla ? ` (${labelTipoFalla(r.data.fechado_tipo_falla)})` : ""}
                    </span>
                  ) : (
                    " · fechado OK"
                  )}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {r.responsable?.nombre ?? "—"}
                  {r.turno?.nombre ? ` · ${r.turno.nombre}` : ""}
                </p>
              </div>
            </div>
          );
        }}
      />

      {(error || errValidacion) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {error ?? errValidacion}
        </div>
      )}
      <div className="h-20" />

      {foco && (
        <NumpadIndustrial
          // key por celda: fuerza el remonte al cambiar de foco para que
          // limpiarAlPrimerDigito se re-evalúe con el valor de la celda nueva.
          key={`${foco.muestraId}:${foco.celda}`}
          limpiarAlPrimerDigito
          valor={valorDeFoco(foco)}
          onCambio={(v) => onCambioFoco(foco, v)}
          onConfirmar={confirmarFoco}
          onCerrar={() => setFoco(null)}
          label={
            foco.celda === "no_conformes"
              ? "Paquetes con fechado no conforme"
              : `Peso paquete ${foco.celda + 1} de ${CANTIDAD_PAQUETES}`
          }
        />
      )}

      {!foco && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-20">
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={onGuardar}
              disabled={enviando}
              className="w-full py-4 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200"
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
                `Guardar ${muestras.length} ${muestras.length === 1 ? "muestra" : "muestras"}`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
