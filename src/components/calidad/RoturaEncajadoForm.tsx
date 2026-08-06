"use client";

// Captura del "Control de Rotura en Encajado".
//
// Una muestra = una hora. Cada muestra tiene las 2 máquinas encajadoras, y cada
// máquina genera SU PROPIO registro: las dos comparten `nroMuestra` y se
// distinguen por `filaProd` (1|2) — mismo patrón que los 12 picos dosificadores
// de DefectosConformadoForm. El correlativo real lo asigna el server por grupo
// de `nroMuestra`, así que mandar el mismo valor en las 2 filas es lo que las
// aparea.
//
// Una máquina marcada como NO muestreada no genera registro. Cargar 0 defectos
// con un denominador inventado sería peor: diluye el porcentaje del día y puede
// cruzar una muestra de "fuera de spec" a "conforme" por una fila fantasma.

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
import {
  porcentajesRotura,
  porcentajesRoturaAgregados,
  totalesRotura,
  conteosDesdeData,
  type CategoriaRotura,
  type ConteosRotura,
  type MuestraRotura,
} from "@/lib/calidad/rotura-encajado";
import type { ProductoActivoLinea } from "@/types/calidad";

type Props = {
  puntoControlId: string;
  lineaProductivaId: string;
  productoActivo: ProductoActivoLinea;
};

const MAQUINAS = [1, 2] as const;
type NroMaquina = (typeof MAQUINAS)[number];

// Espeja `maximum` de unidades_muestreadas y de los contadores en el schema. Si
// se cambia allá, cambiarlo acá: sin este chequeo, un default heredado de un
// producto con caja muy grande se rechaza server-side con un error genérico
// (el modo de falla "0 registros guardados" de ADR-016).
const MAX_UNIDADES = 5000;

// `notas` del registro se arma concatenando la nota de la muestra más el motivo de
// cada máquina no muestreada, y Zod corta `notas` en 1000. Los topes de acá dejan
// el peor caso (nota llena + 2 motivos llenos + prefijos) por debajo de ese límite:
// sin ellos, pasarse rechaza el batch COMPLETO y se pierde toda la carga.
const MAX_NOTAS = 600;
const MAX_MOTIVO = 150;
const MAX_NOTAS_REGISTRO = 1000;

// Etiquetas y agrupamiento para la UI. El orden es el de la planilla de papel.
const CATEGORIAS_UI: { key: CategoriaRotura; label: string; grupo: 1 | 2 }[] = [
  { key: "golpeado_rotura_menor", label: "Golpeado — rotura menor", grupo: 1 },
  { key: "golpeado_rotura_mayor", label: "Golpeado — rotura mayor", grupo: 2 },
  { key: "aplastado_rotura_leve", label: "Aplastado — rotura leve", grupo: 2 },
  { key: "aplastado_rotura_intermedia", label: "Aplastado — rotura intermedia", grupo: 2 },
  { key: "aplastado_rotura_mayor", label: "Aplastado — rotura mayor", grupo: 2 },
];

type EstadoMaquina = {
  muestreada: boolean;
  // El denominador viene prellenado del maestro. Hasta que el operario lo
  // confirme (o lo edite) no se pinta como validado: con una caja incompleta de
  // fin de pallet, un campo ya en verde no se vuelve a mirar y el % sale mal.
  unidadesConfirmadas: boolean;
  // Motivo cuando no se muestreó — se vuelca a `notas` del registro de la otra
  // máquina para que quede asentado por qué falta la fila.
  motivoNoMuestreada: string;
  unidades: string;
  conteos: Record<CategoriaRotura, string>;
};

type MuestraForm = {
  id: number;
  hora: string;
  notas: string;
  maquinas: Record<NroMaquina, EstadoMaquina>;
};

// Celda activa del numpad: qué muestra, qué máquina, qué campo.
type Foco = {
  muestraId: number;
  maquina: NroMaquina;
  campo: CategoriaRotura | "unidades";
};

function conteosVacios(): Record<CategoriaRotura, string> {
  return {
    golpeado_rotura_menor: "",
    golpeado_rotura_mayor: "",
    aplastado_rotura_leve: "",
    aplastado_rotura_intermedia: "",
    aplastado_rotura_mayor: "",
  };
}

// Los 5 contadores en 0 explícito — lo que setea el botón "Sin defectos".
function conteosEnCero(): Record<CategoriaRotura, string> {
  return {
    golpeado_rotura_menor: "0",
    golpeado_rotura_mayor: "0",
    aplastado_rotura_leve: "0",
    aplastado_rotura_intermedia: "0",
    aplastado_rotura_mayor: "0",
  };
}

function crearMaquinaVacia(unidadesDefault: string): EstadoMaquina {
  return {
    muestreada: true,
    // Sin default del maestro no hay nada que confirmar: el operario lo escribe.
    unidadesConfirmadas: unidadesDefault === "",
    motivoNoMuestreada: "",
    unidades: unidadesDefault,
    conteos: conteosVacios(),
  };
}

function crearMuestraVacia(id: number, unidadesDefault: string): MuestraForm {
  return {
    id,
    hora: horaPlanta(),
    notas: "",
    maquinas: {
      1: crearMaquinaVacia(unidadesDefault),
      2: crearMaquinaVacia(unidadesDefault),
    },
  };
}

// Los strings del input a números. Un campo vacío se mapea a 0 para poder mostrar
// el porcentaje en vivo mientras se carga, pero el guardado NO acepta contadores
// vacíos (ver `problema`): si un vacío se guardara como 0, una muestra que nadie
// inspeccionó entraría al ponderado del día como conforme. Para declarar "no hubo
// rotura" está el botón "Sin defectos", que pone los 5 en 0 explícito.
function conteosNumericos(estado: EstadoMaquina): ConteosRotura {
  const leer = (cat: CategoriaRotura): number => {
    const v = estado.conteos[cat];
    if (v === "") return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    golpeado_rotura_menor: leer("golpeado_rotura_menor"),
    golpeado_rotura_mayor: leer("golpeado_rotura_mayor"),
    aplastado_rotura_leve: leer("aplastado_rotura_leve"),
    aplastado_rotura_intermedia: leer("aplastado_rotura_intermedia"),
    aplastado_rotura_mayor: leer("aplastado_rotura_mayor"),
  };
}

function unidadesNumericas(estado: EstadoMaquina): number {
  const n = parseInt(estado.unidades, 10);
  return Number.isFinite(n) ? n : NaN;
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

export function RoturaEncajadoForm({ puntoControlId, lineaProductivaId, productoActivo }: Props) {
  const { data: session } = useSession();
  const loteId = productoActivo.loteId;

  // Default del denominador: el estándar del maestro. Editable porque la caja
  // real a veces está incompleta (fin de pallet, fin de amasijo).
  const unidadesDefault =
    productoActivo.unidadesPorCaja != null ? String(Math.round(productoActivo.unidadesPorCaja)) : "";

  const claveProgreso = claveProgresoMuestras({ lineaProductivaId, loteId, puntoControlId });
  const [muestras, setMuestras, limpiarProgreso] = usePersistedState<MuestraForm[]>(claveProgreso, () => [
    crearMuestraVacia(1, unidadesDefault),
  ]);

  const [refreshKey, setRefreshKey] = useState(0);
  const { registros, cargando, esDemo, error: errorRegistros, recargar } = useRegistrosDelDia(
    puntoControlId,
    lineaProductivaId,
    refreshKey
  );

  // Vuelve a los puntos de control de la línea, no a la raíz de Calidad: el
  // operario suele cargar varios controles seguidos de la misma línea (mismo
  // criterio que PesoMedicionesForm).
  const { enviando, error, exito, guardar } = useBatchGuardar(
    `/calidad/puntos-control?linea=${lineaProductivaId}`,
    () => {
      limpiarProgreso();
      setRefreshKey((k) => k + 1);
    }
  );

  const [foco, setFoco] = useState<Foco | null>(null);
  const [validar, setValidar] = useState(false);

  const specGrupo1 = specDeCampo(productoActivo.especificaciones, "pct_rotura_grupo1");
  const specGrupo2 = specDeCampo(productoActivo.especificaciones, "pct_rotura_grupo2");
  const specTotal = specDeCampo(productoActivo.especificaciones, "pct_rotura_total");

  // ── Mutadores ─────────────────────────────────────────────────────────────

  const patchMuestra = (muestraId: number, patch: Partial<MuestraForm>) =>
    setMuestras((prev) => prev.map((m) => (m.id === muestraId ? { ...m, ...patch } : m)));

  const patchMaquina = (muestraId: number, maquina: NroMaquina, patch: Partial<EstadoMaquina>) =>
    setMuestras((prev) =>
      prev.map((m) =>
        m.id === muestraId
          ? { ...m, maquinas: { ...m.maquinas, [maquina]: { ...m.maquinas[maquina], ...patch } } }
          : m
      )
    );

  const setCampo = (foco: Foco, valor: string) => {
    // Todos los campos de este formulario son enteros: el numpad permite "," y
    // acá se descarta, en vez de dejar que llegue un decimal que AJV rechaza.
    const entero = valor.replace(".", "");
    setMuestras((prev) =>
      prev.map((m) => {
        if (m.id !== foco.muestraId) return m;
        const est = m.maquinas[foco.maquina];
        const nuevo: EstadoMaquina =
          foco.campo === "unidades"
            ? // Editar el denominador a mano ya es confirmarlo.
              { ...est, unidades: entero, unidadesConfirmadas: true }
            : { ...est, conteos: { ...est.conteos, [foco.campo]: entero } };
        return { ...m, maquinas: { ...m.maquinas, [foco.maquina]: nuevo } };
      })
    );
  };

  const valorDeFoco = (f: Foco): string => {
    const m = muestras.find((x) => x.id === f.muestraId);
    if (!m) return "";
    const est = m.maquinas[f.maquina];
    return f.campo === "unidades" ? est.unidades : est.conteos[f.campo];
  };

  const agregarMuestra = () =>
    setMuestras((prev) => [
      ...prev,
      crearMuestraVacia(Math.max(0, ...prev.map((m) => m.id)) + 1, unidadesDefault),
    ]);

  // Confirmación: eliminar una hora descarta hasta 12 campos ya cargados.
  const quitarMuestra = (muestraId: number, hora: string) => {
    if (muestras.length === 1) return;
    if (!window.confirm(`Vas a eliminar la muestra de las ${hora} con lo que tenga cargado. ¿Confirmás?`)) return;
    setMuestras((prev) => prev.filter((m) => m.id !== muestraId));
  };

  // ── Validación ────────────────────────────────────────────────────────────

  const problema = (): string | null => {
    for (const m of muestras) {
      const activas = MAQUINAS.filter((nro) => m.maquinas[nro].muestreada);
      if (activas.length === 0) {
        return `Hora ${m.hora}: marcá al menos una máquina como muestreada, o eliminá la muestra.`;
      }
      for (const nro of activas) {
        const est = m.maquinas[nro];
        const unidades = unidadesNumericas(est);
        if (!Number.isFinite(unidades) || unidades < 1) {
          return `Hora ${m.hora}, máquina ${nro}: ingresá las unidades inspeccionadas.`;
        }
        if (!est.unidadesConfirmadas) {
          return `Hora ${m.hora}, máquina ${nro}: confirmá las unidades inspeccionadas (${est.unidades} viene del maestro del producto).`;
        }
        if (unidades > MAX_UNIDADES) {
          return `Hora ${m.hora}, máquina ${nro}: las unidades inspeccionadas (${unidades}) superan el máximo de ${MAX_UNIDADES}. Corregí el denominador, o el dato de unidades por caja en el maestro del producto.`;
        }
        // Contadores obligatorios: un vacío guardado como 0 haría pasar por
        // conforme una muestra que nadie inspeccionó.
        const sinCargar = CATEGORIAS_UI.filter(({ key }) => est.conteos[key] === "");
        if (sinCargar.length > 0) {
          return `Hora ${m.hora}, máquina ${nro}: faltan ${sinCargar.length} de las 5 categorías. Si no hubo rotura, tocá "Sin defectos".`;
        }
        const conteosEst = conteosNumericos(est);
        const excedido = CATEGORIAS_UI.find(({ key }) => conteosEst[key] > MAX_UNIDADES);
        if (excedido) {
          return `Hora ${m.hora}, máquina ${nro}: el contador "${excedido.label}" supera el máximo de ${MAX_UNIDADES}.`;
        }
        const { total } = totalesRotura(conteosNumericos(est));
        if (total > unidades) {
          return `Hora ${m.hora}, máquina ${nro}: los defectos (${total}) no pueden superar las unidades inspeccionadas (${unidades}).`;
        }
      }
    }
    return null;
  };

  // ── Guardado ──────────────────────────────────────────────────────────────

  const onGuardar = async () => {
    setValidar(true);
    if (problema()) return;

    const registrosACrear = muestrasEnPantalla.length;
    if (
      !window.confirm(
        `Vas a guardar ${muestras.length} ${muestras.length === 1 ? "hora" : "horas"} (${registrosACrear} ${
          registrosACrear === 1 ? "registro" : "registros"
        }) y salir de este punto de control. ¿Confirmás?`
      )
    ) {
      return;
    }

    const hoy = hoyPlanta();

    const registrosBatch = muestras.flatMap((m, idx) => {
      // El motivo de una máquina no muestreada se asienta en las notas de la
      // muestra, así queda registrado por qué falta esa fila.
      const motivos = MAQUINAS.filter((nro) => !m.maquinas[nro].muestreada)
        .map((nro) => {
          const motivo = m.maquinas[nro].motivoNoMuestreada.trim();
          return `Máquina ${nro} no muestreada${motivo ? `: ${motivo}` : ""}`;
        })
        .join(". ");
      // El slice es defensa en profundidad: los maxLength de los inputs ya acotan
      // el total, pero un progreso restaurado de sessionStorage de una versión
      // anterior podría traer strings más largos.
      const notas = [m.notas.trim(), motivos].filter(Boolean).join(" · ").slice(0, MAX_NOTAS_REGISTRO);

      return MAQUINAS.filter((nro) => m.maquinas[nro].muestreada).map((nro) => {
        const est = m.maquinas[nro];
        const conteos = conteosNumericos(est);
        return {
          puntoControlId,
          loteId,
          lineaProductivaId,
          // responsableId se inyecta server-side desde la sesión — nunca desde el cliente
          fecha: hoy,
          hora: m.hora + ":00",
          // Las 2 máquinas de la misma hora comparten nroMuestra a propósito: el
          // server asigna UN correlativo por grupo y así quedan apareadas.
          nroMuestra: idx + 1,
          filaProd: nro,
          notas: notas || undefined,
          data: {
            maquina: nro,
            unidades_muestreadas: unidadesNumericas(est),
            ...conteos,
          },
        };
      });
    });

    await guardar(registrosBatch);
  };

  // ── Agregado del día (ponderado) ──────────────────────────────────────────

  // Filtrado por el lote activo, no por fecha: `useRegistrosDelDia` trae todos los
  // registros de (línea, punto de control, hoy), así que tras un cambio de
  // producto a mitad de jornada el agregado sumaba muestras de dos productos y el
  // indicador las comparaba contra la spec del producto activo AHORA. El operario
  // leía "en spec" sobre un número que no correspondía a ningún producto.
  //
  // Qué debe ser "el día" cuando la línea cambia de producto (por lote, por
  // jornada, por producto) es una definición pendiente que afecta a todos los
  // formularios; por lote es el único denominador defendible sin esa decisión.
  const muestrasGuardadas: MuestraRotura[] = registros
    .filter((r) => r.lote?.numeroLote === productoActivo.numeroLote)
    .map((r) => ({
      conteos: conteosDesdeData(r.data),
      unidadesMuestreadas: Number(r.data.unidades_muestreadas ?? NaN),
    }));

  const muestrasEnPantalla: MuestraRotura[] = muestras.flatMap((m) =>
    MAQUINAS.filter((nro) => m.maquinas[nro].muestreada).map((nro) => ({
      conteos: conteosNumericos(m.maquinas[nro]),
      unidadesMuestreadas: unidadesNumericas(m.maquinas[nro]),
    }))
  );

  const agregado = porcentajesRoturaAgregados([...muestrasGuardadas, ...muestrasEnPantalla]);

  // Si no se pudo traer lo ya cargado hoy, el agregado solo tiene lo de pantalla:
  // no es "el día". Mostrarlo con el mismo formato y con indicador verde/ámbar
  // haría leer "estamos en spec" sobre un denominador incompleto.
  const agregadoIncompleto = cargando || errorRegistros != null;

  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Control de rotura guardado</h2>
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
          Muestreo: 1 caja de cada máquina encajadora. Las 5 categorías se cuentan sobre las unidades
          inspeccionadas.
        </p>
      </div>

      {/* Resumen ponderado del día */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100">
        <div className="flex items-baseline justify-between mb-2">
          {/* "del lote", no "del día": el agregado se filtra por lote activo. */}
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Rotura del lote</h2>
          {!agregadoIncompleto && (
            <span className="text-xs text-gray-600">
              {agregado.registros} {agregado.registros === 1 ? "muestra" : "muestras"} ·{" "}
              {agregado.unidadesInspeccionadas} u. inspeccionadas
            </span>
          )}
        </div>
        {/* Ponderado (suma de no-OK / suma de unidades), no promedio de porcentajes:
            el denominador varía por muestra. */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Grupo 1", valor: agregado.grupo1, spec: specGrupo1 },
            { label: "Grupo 2", valor: agregado.grupo2, spec: specGrupo2 },
            { label: "Total", valor: agregado.total, spec: specTotal },
          ].map(({ label, valor, spec }) => (
            <div key={label} className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">{label}</p>
              <div className="flex items-center gap-1.5">
                <p className="text-xl font-bold font-mono text-gray-900">
                  {agregadoIncompleto ? "—" : fmtPct(valor)}
                </p>
                {/* Sin indicador de spec si el agregado está incompleto: sería
                    señalizar conformidad sobre un denominador parcial. */}
                {spec && !agregadoIncompleto && <IndicadorSpec valor={valor} spec={spec} />}
              </div>
              {spec && <RangoObjetivo spec={spec} />}
            </div>
          ))}
        </div>
        {agregadoIncompleto ? (
          <p className="text-xs text-gray-600 mt-2">
            {cargando
              ? "Cargando los registros de hoy..."
              : "No se pudo traer lo ya cargado hoy — el % del lote está incompleto. Podés seguir cargando igual."}
          </p>
        ) : (
          !specTotal && (
            <p className="text-xs text-gray-600 mt-2">
              Sin tolerancia cargada para este producto: los porcentajes se registran igual, pero no se
              comparan contra nada. Se define en Maestro → Especificaciones.
            </p>
          )
        )}
      </div>

      {/* Muestras */}
      {muestras.map((muestra, idx) => (
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

          {MAQUINAS.map((nro) => {
            const est = muestra.maquinas[nro];
            const conteos = conteosNumericos(est);
            const unidades = unidadesNumericas(est);
            const pct = porcentajesRotura(conteos, unidades);
            const totales = totalesRotura(conteos);
            const excede = Number.isFinite(unidades) && totales.total > unidades;

            return (
              <div
                key={nro}
                className={`rounded-xl border-2 p-3 space-y-3 ${
                  est.muestreada ? "border-gray-200" : "border-gray-100 bg-gray-50"
                }`}
              >
                <div className="space-y-2">
                  <p className="text-sm font-bold text-gray-800">Máquina {nro}</p>
                  {/* Segmented control de dos opciones explícitas en vez de un
                      botón único: un botón verde que dice "Muestreada" se lee tanto
                      como estado actual como como acción a ejecutar. */}
                  <div className="flex gap-2">
                    {([true, false] as const).map((valor) => (
                      <button
                        key={String(valor)}
                        type="button"
                        aria-pressed={est.muestreada === valor}
                        onClick={() =>
                          patchMaquina(muestra.id, nro, {
                            muestreada: valor,
                            // Al volver a "se muestreó" se limpia el motivo para no
                            // dejarlo colgado en el registro.
                            motivoNoMuestreada: valor ? "" : est.motivoNoMuestreada,
                          })
                        }
                        className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all active:scale-95 ${
                          est.muestreada === valor
                            ? valor
                              ? "bg-green-500 text-white border-green-600 shadow"
                              : "bg-gray-600 text-white border-gray-700 shadow"
                            : "bg-gray-100 text-gray-700 border-gray-200"
                        }`}
                      >
                        {valor ? "Se muestreó" : "No se muestreó"}
                      </button>
                    ))}
                  </div>
                  {/* La consecuencia es la información crítica del control, así que
                      va siempre visible y legible, no en 11px gris después de
                      cambiar de estado. */}
                  <p className="text-sm text-gray-700">
                    {est.muestreada
                      ? "Genera un registro y cuenta en el % del día."
                      : "No genera registro para esta máquina en esta hora."}
                  </p>
                </div>

                {!est.muestreada ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                      Motivo (opcional)
                    </label>
                    <input
                      type="text"
                      value={est.motivoNoMuestreada}
                      onChange={(e) => patchMaquina(muestra.id, nro, { motivoNoMuestreada: e.target.value })}
                      placeholder="Parada, cambio de formato..."
                      maxLength={MAX_MOTIVO}
                      className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-white text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                        Unidades inspeccionadas
                      </p>
                      <button
                        type="button"
                        aria-label={`Unidades inspeccionadas, máquina ${nro}, ${est.unidades || "sin cargar"}`}
                        onClick={() => setFoco({ muestraId: muestra.id, maquina: nro, campo: "unidades" })}
                        className={`w-full rounded-xl border-2 py-2.5 transition-all active:scale-95 ${
                          foco?.muestraId === muestra.id && foco.maquina === nro && foco.campo === "unidades"
                            ? "border-[#E1000F] bg-red-50"
                            : est.unidades === ""
                            ? "border-gray-200 bg-gray-50"
                            : est.unidadesConfirmadas
                            ? "border-green-300 bg-green-50"
                            : "border-amber-300 bg-amber-50"
                        }`}
                      >
                        <span
                          className={`text-2xl font-bold font-mono ${
                            est.unidades !== "" ? "text-gray-900" : "text-gray-300"
                          }`}
                        >
                          {est.unidades || "—"}
                        </span>
                      </button>
                      {/* Un default heredado del maestro no es un dato verificado.
                          Se pide confirmación explícita porque la caja de fin de
                          pallet suele estar incompleta y el denominador manda en
                          todos los porcentajes. */}
                      {est.unidades !== "" && !est.unidadesConfirmadas && (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-xs text-amber-700">
                            Heredado del producto — confirmá si la caja está completa.
                          </p>
                          <button
                            type="button"
                            onClick={() => patchMaquina(muestra.id, nro, { unidadesConfirmadas: true })}
                            className="px-3 py-2 rounded-lg text-xs font-bold border-2 bg-white text-amber-700 border-amber-300 shrink-0 transition-all active:scale-95"
                          >
                            Confirmar
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                        Unidades no conformes por categoría
                      </p>
                      {/* "Todo OK" tiene que ser un acto explícito de un toque, no
                          el resultado de dejar las 5 celdas sin tocar. */}
                      <button
                        type="button"
                        onClick={() => patchMaquina(muestra.id, nro, { conteos: conteosEnCero() })}
                        className="px-3 py-2 rounded-lg text-xs font-bold border-2 bg-green-50 text-green-700 border-green-200 transition-all active:scale-95"
                      >
                        Sin defectos
                      </button>
                    </div>

                    {/* Dos bloques con cabecera propia: el agrupamiento G1/G2 es lo
                        que define la tolerancia de la ET, y como prefijo de 10px
                        gris no se leía. */}
                    {([1, 2] as const).map((grupo) => (
                      <div key={grupo} className="space-y-1.5">
                        <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">
                          {grupo === 1 ? "Grupo 1 — golpe menor" : "Grupo 2 — rotura relevante"}
                        </p>
                        {CATEGORIAS_UI.filter((c) => c.grupo === grupo).map(({ key, label }) => {
                          const activo =
                            foco?.muestraId === muestra.id && foco.maquina === nro && foco.campo === key;
                          const valor = est.conteos[key];
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setFoco({ muestraId: muestra.id, maquina: nro, campo: key })}
                              aria-label={`Grupo ${grupo}, ${label}, máquina ${nro}, ${
                                valor === "" ? "sin cargar" : valor
                              }`}
                              className={`w-full flex items-center justify-between gap-3 rounded-xl border-2 px-3 py-3 text-left transition-all active:scale-95 ${
                                activo
                                  ? "border-[#E1000F] bg-red-50"
                                  : valor !== "" && valor !== "0"
                                  ? "border-amber-300 bg-amber-50"
                                  : "border-gray-200 bg-gray-50"
                              }`}
                            >
                              <span className="text-xs font-semibold text-gray-700 min-w-0">{label}</span>
                              {/* Vacío muestra "—", NO "0": un contador nunca tocado
                                  y un cero explícito tienen que verse distinto. Antes
                                  ambos mostraban "0" y una muestra sin inspeccionar
                                  era indistinguible de una conforme. */}
                              <span
                                className={`text-xl font-bold font-mono shrink-0 ${
                                  valor !== "" ? "text-gray-900" : "text-gray-300"
                                }`}
                              >
                                {valor === "" ? "—" : valor}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}

                    <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-3 py-2">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                        G1 {fmtPct(pct.grupo1)} · G2 {fmtPct(pct.grupo2)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-sm font-bold font-mono text-gray-900">
                          Total {fmtPct(pct.total)}
                        </span>
                        {specTotal && <IndicadorSpec valor={pct.total} spec={specTotal} conTexto />}
                      </span>
                    </div>

                    {excede && (
                      <p className="text-xs font-semibold text-[#E1000F]">
                        Los defectos ({totales.total}) superan las unidades inspeccionadas ({unidades}).
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Notas de la muestra (opcional)
            </label>
            <input
              type="text"
              value={muestra.notas}
              onChange={(e) => patchMuestra(muestra.id, { notas: e.target.value })}
              maxLength={MAX_NOTAS}
              className="w-full py-2 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none"
            />
          </div>
        </div>
      ))}

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
          const conteos = conteosDesdeData(r.data);
          const unidades = Number(r.data.unidades_muestreadas ?? NaN);
          const pct = porcentajesRotura(conteos, unidades);
          return (
            <div className="flex items-start gap-3">
              <span className="text-xs font-mono font-semibold text-gray-500 bg-gray-100 rounded-lg px-2 py-1 shrink-0">
                {r.hora?.slice(0, 5) ?? "—"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800">
                  Máquina {String(r.data.maquina ?? "—")} · n={Number.isFinite(unidades) ? unidades : "—"} ·
                  G1 {fmtPct(pct.grupo1)} · G2 {fmtPct(pct.grupo2)} · Total {fmtPct(pct.total)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {r.responsable?.nombre ?? "—"}
                  {r.turno?.nombre ? ` · ${r.turno.nombre}` : ""}
                </p>
                {/* Las notas guardan el motivo de una máquina no muestreada: sin
                    mostrarlas, quien revisa el día ve que falta una fila y no sabe
                    por qué. */}
                {r.notas && <p className="text-xs text-gray-600 mt-0.5 italic">{r.notas}</p>}
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
          key={`${foco.muestraId}:${foco.maquina}:${foco.campo}`}
          limpiarAlPrimerDigito
          valor={valorDeFoco(foco)}
          onCambio={(v) => setCampo(foco, v)}
          onConfirmar={() => setFoco(null)}
          onCerrar={() => setFoco(null)}
          label={
            foco.campo === "unidades"
              ? `Máquina ${foco.maquina} — unidades inspeccionadas`
              : `Máquina ${foco.maquina} — ${
                  CATEGORIAS_UI.find((c) => c.key === foco.campo)?.label ?? ""
                }`
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
                `Guardar ${muestrasEnPantalla.length} ${
                  muestrasEnPantalla.length === 1 ? "registro" : "registros"
                }`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
