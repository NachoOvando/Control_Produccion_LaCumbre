"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductoRow, BindingRow, EspecRow } from "@/types/maestro";
import { BackHeader } from "./ProductosPanel";

type Props = {
  producto: ProductoRow;
  bindings: BindingRow[];
  especificaciones: EspecRow[];
  onVolver: () => void;
};

// Editor de specs por producto: una fila por binding (punto de control ×
// parámetro), agrupadas por punto de control. Cada fila edita/guarda su propia
// versión (un POST = una versión nueva; ver ADR-015). El límite crítico es
// opcional y se marca aparte — superarlo NO bloquea el guardado del registro.
export function EspecificacionesEditor({ producto, bindings, especificaciones, onVolver }: Props) {
  const specPorBinding = useMemo(() => {
    const m = new Map<string, EspecRow>();
    for (const e of especificaciones) m.set(`${e.puntoControlId}::${e.parametroId}`, e);
    return m;
  }, [especificaciones]);

  const grupos = useMemo(() => {
    const g = new Map<string, { nombre: string; items: BindingRow[] }>();
    for (const b of bindings) {
      const grupo = g.get(b.puntoControlId) ?? { nombre: b.puntoControlNombre, items: [] };
      grupo.items.push(b);
      g.set(b.puntoControlId, grupo);
    }
    return [...g.values()];
  }, [bindings]);

  return (
    <div className="space-y-4">
      <BackHeader titulo="Especificaciones" onVolver={onVolver} />
      <div className="bg-white rounded-2xl p-4 border border-gray-100">
        <p className="text-sm font-bold text-gray-900">{producto.nombre}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {producto.familiaNombre} · {producto.marcaNombre}
        </p>
      </div>

      {grupos.map((grupo) => (
        <div key={grupo.nombre} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{grupo.nombre}</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {grupo.items.map((b) => (
              <EspecFila
                key={`${b.puntoControlId}::${b.parametroId}`}
                producto={producto}
                binding={b}
                spec={specPorBinding.get(`${b.puntoControlId}::${b.parametroId}`) ?? null}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const numInput =
  "w-full py-2 px-2 rounded-lg border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 text-center focus:border-[#E1000F] focus:outline-none";

function EspecFila({ producto, binding, spec }: { producto: ProductoRow; binding: BindingRow; spec: EspecRow | null }) {
  const router = useRouter();
  const [objetivo, setObjetivo] = useState(fmt(spec?.objetivo));
  const [aMin, setAMin] = useState(fmt(spec?.aceptacionMin));
  const [aMax, setAMax] = useState(fmt(spec?.aceptacionMax));
  const [cMin, setCMin] = useState(fmt(spec?.criticoMin));
  const [cMax, setCMax] = useState(fmt(spec?.criticoMax));
  const [esCritico, setEsCritico] = useState(spec?.esCritico ?? false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState(false);

  const onGuardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/calidad/maestro/especificaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productoId: producto.id,
          puntoControlId: binding.puntoControlId,
          parametroId: binding.parametroId,
          objetivo: parse(objetivo),
          aceptacionMin: parse(aMin),
          aceptacionMax: parse(aMax),
          criticoMin: parse(cMin),
          criticoMax: parse(cMax),
          esCritico,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error al guardar");
        return;
      }
      setOkFlash(true);
      setTimeout(() => setOkFlash(false), 1500);
      router.refresh();
    } catch {
      setError("Error de conexión");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">
          {binding.parametroNombre} <span className="text-xs font-normal text-gray-400">({binding.unidad})</span>
          {binding.agregacion === "derivado" && (
            <span className="ml-2 text-[11px] text-amber-600">se evalúa al cierre</span>
          )}
          {spec && <span className="ml-2 text-[11px] text-gray-400">v{spec.version}</span>}
        </p>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
          <input type="checkbox" checked={esCritico} onChange={(e) => setEsCritico(e.target.checked)} />
          Crítico (PCC)
        </label>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        <Campo label="Crít. mín" value={cMin} onChange={setCMin} />
        <Campo label="Acept. mín" value={aMin} onChange={setAMin} />
        <Campo label="Objetivo" value={objetivo} onChange={setObjetivo} />
        <Campo label="Acept. máx" value={aMax} onChange={setAMax} />
        <Campo label="Crít. máx" value={cMax} onChange={setCMax} />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onGuardar}
          disabled={enviando}
          className={`text-xs font-semibold rounded-lg px-3 py-1.5 active:scale-95 transition-all disabled:opacity-50 ${
            okFlash ? "bg-green-100 text-green-700" : "bg-[#E1000F] text-white hover:bg-[#c0000d]"
          }`}
        >
          {okFlash ? "✓ Guardado" : enviando ? "…" : spec ? "Actualizar" : "Guardar"}
        </button>
      </div>
    </li>
  );
}

function Campo({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-400 text-center mb-0.5">{label}</label>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={numInput} />
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

function parse(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
