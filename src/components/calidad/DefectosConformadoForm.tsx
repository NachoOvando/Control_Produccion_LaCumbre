"use client";
import { hoyPlanta, horaPlanta } from "@/lib/calidad/fecha-planta";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ProductoActivoBanner } from "@/components/calidad/ProductoActivoBanner";
import type { ProductoActivoLinea } from "@/types/calidad";

// ------- Tipos ------- //

type Fistula = "Sin fístula" | "Fístula <1cm" | "Fístula >1cm";
type Barril = "Sin barril" | "Barril aprobado" | "Barril rechazado";
type Ventana = "Sin ventana" | "Ventana ≤1cm" | "Ventana 1-3cm" | "Ventana >5cm";

type FilaData = {
  fistula: Fistula | null;
  barril: Barril | null;
  ventana: Ventana | null;
  mal_baniado: boolean;
  peso_neto: string; // string para el input, se convierte a number al guardar
};

type MuestraData = {
  id: number;
  hora: string;
  notas: string;
  filas: FilaData[];
};

type Props = {
  puntoControlId: string;
  lineaProductivaId: string;
  productoActivo: ProductoActivoLinea;
};

// ------- Helpers ------- //

function crearFilaVacia(): FilaData {
  return { fistula: null, barril: null, ventana: null, mal_baniado: false, peso_neto: "" };
}

function crearMuestraVacia(id: number): MuestraData {
  return {
    id,
    hora: horaPlanta(),
    notas: "",
    filas: Array.from({ length: 12 }, crearFilaVacia),
  };
}

function muestraTieneDefectos(muestra: MuestraData): boolean {
  return muestra.filas.some(
    (f) =>
      f.fistula !== "Sin fístula" && f.fistula !== null ||
      f.barril === "Barril rechazado" ||
      (f.ventana !== "Sin ventana" && f.ventana !== null) ||
      f.mal_baniado
  );
}

function horaActual(): string {
  return horaPlanta();
}

// ------- Chips de selección ------- //

type ChipOption<T> = { label: T; severidad: "sin-defecto" | "leve" | "grave" };

function ChipSelector<T extends string>({
  opciones,
  valor,
  onChange,
  label,
}: {
  opciones: ChipOption<T>[];
  valor: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  const colorMap = {
    "sin-defecto": {
      base: "bg-green-100 text-green-800 border-2 border-green-200",
      activo: "bg-green-500 text-white border-green-600 shadow",
    },
    leve: {
      base: "bg-amber-100 text-amber-800 border-2 border-amber-200",
      activo: "bg-amber-500 text-white border-amber-600 shadow",
    },
    grave: {
      base: "bg-red-100 text-red-800 border-2 border-red-200",
      activo: "bg-red-600 text-white border-red-700 shadow",
    },
  };

  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {opciones.map((op) => {
          const esActivo = valor === op.label;
          const colors = colorMap[op.severidad];
          return (
            <button
              key={op.label}
              type="button"
              onClick={() => onChange(op.label)}
              className={`
                px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95
                ${esActivo ? colors.activo : colors.base}
              `}
            >
              {op.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------- Fila de producción (acordeón) ------- //

function FilaCard({
  fila,
  indice,
  data,
  onChange,
}: {
  fila: number;
  indice: number;
  data: FilaData;
  onChange: (d: FilaData) => void;
}) {
  const [abierta, setAbierta] = useState(false);

  const tieneDefecto =
    (data.fistula !== null && data.fistula !== "Sin fístula") ||
    data.barril === "Barril rechazado" ||
    (data.ventana !== null && data.ventana !== "Sin ventana") ||
    data.mal_baniado;

  const completa = data.fistula !== null && data.barril !== null && data.ventana !== null && data.peso_neto !== "";

  return (
    <div className={`rounded-2xl border-2 transition-colors ${tieneDefecto ? "border-red-200 bg-red-50/30" : "border-gray-100 bg-white"}`}>
      {/* Encabezado del acordeón */}
      <button
        type="button"
        onClick={() => setAbierta(!abierta)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
            {fila}
          </span>
          <div className="text-left">
            <p className="text-sm font-semibold text-gray-800">Fila {fila}</p>
            <p className="text-xs text-gray-400">
              {completa ? (
                <span className="text-green-600 font-medium">Completa</span>
              ) : (
                <span className="text-amber-600">Sin completar</span>
              )}
              {tieneDefecto && <span className="text-red-600 font-medium ml-2">⚠ Con defectos</span>}
            </p>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${abierta ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Contenido del acordeón */}
      {abierta && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          <ChipSelector<Fistula>
            label="Fístula"
            valor={data.fistula}
            onChange={(v) => onChange({ ...data, fistula: v })}
            opciones={[
              { label: "Sin fístula", severidad: "sin-defecto" },
              { label: "Fístula <1cm", severidad: "leve" },
              { label: "Fístula >1cm", severidad: "grave" },
            ]}
          />

          <ChipSelector<Barril>
            label="Barril"
            valor={data.barril}
            onChange={(v) => onChange({ ...data, barril: v })}
            opciones={[
              { label: "Sin barril", severidad: "sin-defecto" },
              { label: "Barril aprobado", severidad: "leve" },
              { label: "Barril rechazado", severidad: "grave" },
            ]}
          />

          <ChipSelector<Ventana>
            label="Ventana"
            valor={data.ventana}
            onChange={(v) => onChange({ ...data, ventana: v })}
            opciones={[
              { label: "Sin ventana", severidad: "sin-defecto" },
              { label: "Ventana ≤1cm", severidad: "leve" },
              { label: "Ventana 1-3cm", severidad: "leve" },
              { label: "Ventana >5cm", severidad: "grave" },
            ]}
          />

          {/* Mal bañado */}
          <div className="mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Mal bañado</p>
            <button
              type="button"
              onClick={() => onChange({ ...data, mal_baniado: !data.mal_baniado })}
              className={`
                px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95
                ${data.mal_baniado
                  ? "bg-red-600 text-white border-red-700 shadow"
                  : "bg-green-100 text-green-800 border-green-200"
                }
              `}
            >
              {data.mal_baniado ? "Sí — Mal bañado" : "No — Bañado correcto"}
            </button>
          </div>

          {/* Peso neto */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Peso neto (g) — rango válido: 60–100 g
            </p>
            <input
              type="number"
              inputMode="decimal"
              min={60}
              max={100}
              step={0.1}
              value={data.peso_neto}
              onChange={(e) => onChange({ ...data, peso_neto: e.target.value })}
              placeholder="ej: 78.5"
              className="
                w-full text-2xl font-bold text-center py-3 px-4 rounded-xl border-2 border-gray-200
                focus:border-[#E1000F] focus:outline-none bg-gray-50
                [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
              "
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ------- Tab de muestra ------- //

function MuestraTab({
  muestra,
  activa,
  onClick,
  onDelete,
  puedeEliminar,
}: {
  muestra: MuestraData;
  activa: boolean;
  onClick: () => void;
  onDelete: () => void;
  puedeEliminar: boolean;
}) {
  const tieneDefectos = muestraTieneDefectos(muestra);

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={onClick}
        className={`
          px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5
          ${activa
            ? "bg-white text-[#E1000F] shadow border border-gray-200"
            : "text-gray-600 hover:bg-white/60"
          }
        `}
      >
        M{muestra.id}
        {tieneDefectos && <span className="text-amber-500 text-base leading-none">⚠</span>}
      </button>
      {puedeEliminar && activa && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ------- Formulario principal ------- //

export function DefectosConformadoForm({ puntoControlId, lineaProductivaId, productoActivo }: Props) {
  const router = useRouter();
  const { data: session } = useSession();

  // Estado del formulario
  const loteId = productoActivo.loteId;
  const [muestras, setMuestras] = useState<MuestraData[]>([crearMuestraVacia(1)]);
  const [muestraActivaId, setMuestraActivaId] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const muestraActiva = muestras.find((m) => m.id === muestraActivaId)!;
  const muestraActivaIdx = muestras.findIndex((m) => m.id === muestraActivaId);

  // Actualizar un campo de la muestra activa
  const updateMuestra = useCallback((campo: keyof Omit<MuestraData, "id" | "filas">, valor: string) => {
    setMuestras((prev) =>
      prev.map((m) => (m.id === muestraActivaId ? { ...m, [campo]: valor } : m))
    );
  }, [muestraActivaId]);

  // Actualizar una fila de la muestra activa
  const updateFila = useCallback((filaIdx: number, data: FilaData) => {
    setMuestras((prev) =>
      prev.map((m) =>
        m.id === muestraActivaId
          ? { ...m, filas: m.filas.map((f, i) => (i === filaIdx ? data : f)) }
          : m
      )
    );
  }, [muestraActivaId]);

  const agregarMuestra = () => {
    const nuevoId = Math.max(...muestras.map((m) => m.id)) + 1;
    const nueva = crearMuestraVacia(nuevoId);
    nueva.hora = horaActual();
    setMuestras((prev) => [...prev, nueva]);
    setMuestraActivaId(nuevoId);
  };

  const eliminarMuestraActiva = () => {
    if (muestras.length <= 1) return;
    const nuevas = muestras.filter((m) => m.id !== muestraActivaId);
    setMuestras(nuevas);
    setMuestraActivaId(nuevas[Math.max(0, muestraActivaIdx - 1)].id);
  };

  // Guardar jornada completa — un solo request atómico vía batch endpoint
  const guardar = async () => {
    const hoy = hoyPlanta();

    const registros = muestras.flatMap((muestra, muestraIdx) =>
      muestra.filas.map((fila, filaIdx) => ({
        puntoControlId,
        loteId,
        lineaProductivaId,
        // responsableId se inyecta server-side desde la sesión — no se envía desde el cliente
        fecha: hoy,
        hora: muestra.hora + ":00",
        nroMuestra: muestraIdx + 1,
        filaProd: filaIdx + 1,
        notas: muestra.notas || undefined,
        data: {
          fistula: fila.fistula,
          barril: fila.barril,
          ventana: fila.ventana,
          mal_baniado: fila.mal_baniado,
          peso_neto: fila.peso_neto !== "" ? parseFloat(fila.peso_neto) : null,
        },
      }))
    );

    const incompletos = registros.filter(
      (r) => !r.data.fistula || !r.data.barril || !r.data.ventana || r.data.peso_neto === null
    );
    if (incompletos.length > 0) {
      setError(`Hay ${incompletos.length} fila(s) con campos incompletos. Completá todos antes de guardar.`);
      return;
    }

    setEnviando(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/calidad/registros/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registros),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Error al guardar los registros.");
        return;
      }

      setExito(true);
      setTimeout(() => router.push("/calidad"), 2000);
    } catch {
      setError("Error de conexión. Verificá la red e intentá nuevamente.");
    } finally {
      setEnviando(false);
    }
  };

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

  return (
    <div className="space-y-4">
      {/* Producto en producción */}
      <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />

      {/* Tabs de muestras + botón agregar */}
      <div className="bg-[#f0f0f0] rounded-xl p-3 flex items-center gap-2 overflow-x-auto">
        {muestras.map((m) => (
          <MuestraTab
            key={m.id}
            muestra={m}
            activa={m.id === muestraActivaId}
            onClick={() => setMuestraActivaId(m.id)}
            onDelete={eliminarMuestraActiva}
            puedeEliminar={muestras.length > 1}
          />
        ))}
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

      {/* Datos de la muestra activa */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
        {/* Operario registrado — viene de sesión, no editable */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="text-xs text-gray-500">Registrando como:</span>
          <span className="text-xs font-semibold text-gray-800">{session?.user?.name ?? "—"}</span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Hora de muestra</label>
          <input
            type="time"
            value={muestraActiva.hora}
            onChange={(e) => updateMuestra("hora", e.target.value)}
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notas (opcional)</label>
          <textarea
            value={muestraActiva.notas}
            onChange={(e) => updateMuestra("notas", e.target.value)}
            rows={2}
            placeholder="Observaciones de la muestra..."
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* Filas de producción — acordeón */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-gray-700 px-1">Filas de producción — Muestra {muestraActiva.id}</h2>
        {muestraActiva.filas.map((fila, idx) => (
          <FilaCard
            key={idx}
            fila={idx + 1}
            indice={idx}
            data={fila}
            onChange={(d) => updateFila(idx, d)}
          />
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Botón guardar — sticky bottom */}
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
              `Guardar jornada (${muestras.length} muestra${muestras.length > 1 ? "s" : ""}, ${muestras.length * 12} filas)`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
