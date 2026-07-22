"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductoRow, MarcaRow, FamiliaRow, BindingRow, EspecRow } from "@/types/maestro";
import { EspecificacionesEditor } from "./EspecificacionesEditor";

type Props = {
  productos: ProductoRow[];
  marcas: MarcaRow[];
  familias: FamiliaRow[];
  bindings: BindingRow[];
  especificaciones: EspecRow[];
};

type Modo = { tipo: "lista" } | { tipo: "form"; producto: ProductoRow | null } | { tipo: "specs"; producto: ProductoRow };

const inputCls =
  "w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none";
const labelCls = "block text-xs font-semibold text-gray-500 mb-1";

export function ProductosPanel({ productos, marcas, familias, bindings, especificaciones }: Props) {
  const [modo, setModo] = useState<Modo>({ tipo: "lista" });
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter(
      (p) => p.nombre.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)
    );
  }, [productos, busqueda]);

  if (modo.tipo === "form") {
    return (
      <ProductoForm
        producto={modo.producto}
        marcas={marcas}
        familias={familias}
        onVolver={() => setModo({ tipo: "lista" })}
      />
    );
  }

  if (modo.tipo === "specs") {
    const specsProducto = especificaciones.filter((e) => e.productoId === modo.producto.id);
    return (
      <EspecificacionesEditor
        producto={modo.producto}
        bindings={bindings}
        especificaciones={specsProducto}
        onVolver={() => setModo({ tipo: "lista" })}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o SKU…"
          className={inputCls + " flex-1"}
        />
        <button
          type="button"
          onClick={() => setModo({ tipo: "form", producto: null })}
          className="px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 transition-all whitespace-nowrap"
        >
          + Nuevo
        </button>
      </div>

      <ul className="divide-y divide-gray-100 bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {filtrados.length === 0 && <li className="p-6 text-center text-sm text-gray-400">Sin productos que coincidan</li>}
        {filtrados.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {p.nombre}
                {!p.activo && <span className="ml-2 text-xs text-gray-400 font-normal">(inactivo)</span>}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {p.familiaNombre} · {p.marcaNombre}
                {p.sku ? ` · ${p.sku}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setModo({ tipo: "specs", producto: p })}
              className="text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 active:scale-95 transition-all whitespace-nowrap"
            >
              Especificaciones
            </button>
            <button
              type="button"
              onClick={() => setModo({ tipo: "form", producto: p })}
              className="text-xs font-semibold text-[#E1000F] border border-[#E1000F] rounded-lg px-2.5 py-1.5 hover:bg-red-50 active:scale-95 transition-all"
            >
              Editar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Campos numéricos del producto en el form (subconjunto editable del maestro).
const CAMPOS_NUM: { key: keyof ProductoRow; label: string }[] = [
  { key: "pesoGramos", label: "Peso (g)" },
  { key: "unidadesPorCaja", label: "Unidades por caja" },
  { key: "cajasPorPallet", label: "Cajas por pallet" },
  { key: "vidaUtilMeses", label: "Vida útil (meses)" },
  { key: "rendimientoTeorico", label: "Rendimiento teórico" },
  { key: "pesoMasaCrudaG", label: "Peso masa cruda (g)" },
];

function ProductoForm({
  producto,
  marcas,
  familias,
  onVolver,
}: {
  producto: ProductoRow | null;
  marcas: MarcaRow[];
  familias: FamiliaRow[];
  onVolver: () => void;
}) {
  const router = useRouter();
  const esEdicion = producto != null;

  const [sku, setSku] = useState(producto?.sku ?? "");
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [familiaId, setFamiliaId] = useState(producto?.familiaId ?? "");
  const [marcaId, setMarcaId] = useState(producto?.marcaId ?? "");
  const [gusto, setGusto] = useState(producto?.gusto ?? "");
  const [nums, setNums] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of CAMPOS_NUM) {
      const v = producto?.[c.key] as number | null | undefined;
      init[c.key] = v == null ? "" : String(v);
    }
    return init;
  });
  const [esSemielaborado, setEsSemielaborado] = useState(producto?.esSemielaborado ?? false);
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [observaciones, setObservaciones] = useState(producto?.observaciones ?? "");

  const [validar, setValidar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numOrNull = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const onGuardar = async () => {
    setValidar(true);
    if (!nombre.trim() || !familiaId || !marcaId) return;

    const payload = {
      sku: sku.trim() || null,
      nombre: nombre.trim(),
      familiaId,
      marcaId,
      gusto: gusto.trim() || null,
      pesoGramos: numOrNull(nums.pesoGramos),
      unidadesPorCaja: numOrNull(nums.unidadesPorCaja),
      cajasPorPallet: numOrNull(nums.cajasPorPallet),
      vidaUtilMeses: numOrNull(nums.vidaUtilMeses),
      rendimientoTeorico: numOrNull(nums.rendimientoTeorico),
      pesoMasaCrudaG: numOrNull(nums.pesoMasaCrudaG),
      esSemielaborado,
      observaciones: observaciones.trim() || null,
      activo,
    };

    setEnviando(true);
    setError(null);
    try {
      const url = esEdicion ? `/api/v1/calidad/maestro/productos/${producto!.id}` : "/api/v1/calidad/maestro/productos";
      const res = await fetch(url, {
        method: esEdicion ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error al guardar el producto.");
        return;
      }
      router.refresh();
      onVolver();
    } catch {
      setError("Error de conexión. Verificá la red e intentá de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4">
      <BackHeader titulo={esEdicion ? "Editar producto" : "Nuevo producto"} onVolver={onVolver} />

      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4">
        <div>
          <label className={labelCls}>Nombre (descripción estándar) *</label>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={inputCls + (validar && !nombre.trim() ? " border-red-300" : "")}
          />
          {validar && !nombre.trim() && <p className="text-xs text-red-600 mt-1">El nombre es obligatorio</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Familia *</label>
            <select
              value={familiaId}
              onChange={(e) => setFamiliaId(e.target.value)}
              className={inputCls + (validar && !familiaId ? " border-red-300" : "")}
            >
              <option value="">—</option>
              {familias.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Marca *</label>
            <select
              value={marcaId}
              onChange={(e) => setMarcaId(e.target.value)}
              className={inputCls + (validar && !marcaId ? " border-red-300" : "")}
            >
              <option value="">—</option>
              {marcas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>SKU (opcional)</label>
            <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Gusto (opcional)</label>
            <input type="text" value={gusto} onChange={(e) => setGusto(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {CAMPOS_NUM.map((c) => (
            <div key={c.key}>
              <label className={labelCls}>{c.label}</label>
              <input
                type="text"
                inputMode="decimal"
                value={nums[c.key]}
                onChange={(e) => setNums((prev) => ({ ...prev, [c.key]: e.target.value }))}
                className={inputCls}
              />
            </div>
          ))}
        </div>

        <div>
          <label className={labelCls}>Observaciones (opcional)</label>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            className={inputCls + " resize-none"}
          />
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={esSemielaborado} onChange={(e) => setEsSemielaborado(e.target.checked)} />
            Semielaborado
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo
          </label>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onGuardar}
          disabled={enviando}
          className="flex-1 py-3.5 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 transition-all"
        >
          {enviando ? "Guardando…" : esEdicion ? "Guardar cambios" : "Crear producto"}
        </button>
        <button
          type="button"
          onClick={onVolver}
          className="px-6 py-3.5 rounded-2xl text-sm font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 active:scale-95 transition-all"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function BackHeader({ titulo, onVolver }: { titulo: string; onVolver: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onVolver}
        className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors"
        aria-label="Volver"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 className="text-base font-bold text-gray-900">{titulo}</h2>
    </div>
  );
}
