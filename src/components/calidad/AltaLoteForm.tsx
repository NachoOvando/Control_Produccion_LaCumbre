"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { hoyPlanta } from "@/lib/calidad/fecha-planta";

type ProductoOption = {
  id: string;
  nombre: string;
  familia: { nombre: string };
  marca: { nombre: string };
};

type Props = { productos: ProductoOption[] };

export function AltaLoteForm({ productos }: Props) {
  const router = useRouter();
  const [productoId, setProductoId] = useState("");
  const [fechaProduccion, setFechaProduccion] = useState(hoyPlanta());
  const [notas, setNotas] = useState("");

  // Agrupar por familia reduce el escaneo lineal de 104 opciones planas
  const productosPorFamilia = useMemo(() => {
    const grupos: Record<string, ProductoOption[]> = {};
    for (const p of productos) {
      (grupos[p.familia.nombre] ??= []).push(p);
    }
    return grupos;
  }, [productos]);
  const [validar, setValidar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loteCreado, setLoteCreado] = useState<{ numeroLote: string } | null>(null);

  const onGuardar = async () => {
    setValidar(true);
    if (!productoId || !fechaProduccion) return;

    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/calidad/lotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productoId, fechaProduccion, notas: notas.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error al crear el lote.");
        return;
      }
      setLoteCreado({ numeroLote: json.data.numeroLote });
      setTimeout(() => router.push("/calidad/puntos-control"), 2000);
    } catch {
      setError("Error de conexión. Verificá la red e intentá de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  if (loteCreado) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Lote {loteCreado.numeroLote} creado</h2>
        <p className="text-gray-500 text-sm">Volviendo a puntos de control...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Producto</label>
          <select
            value={productoId}
            onChange={(e) => setProductoId(e.target.value)}
            className={`w-full py-3 px-4 rounded-xl border-2 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none ${
              validar && !productoId ? "border-red-300" : "border-gray-200"
            }`}
          >
            <option value="">— Seleccioná el producto —</option>
            {Object.entries(productosPorFamilia).map(([familia, items]) => (
              <optgroup key={familia} label={familia}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({p.marca.nombre})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {validar && !productoId && <p className="text-xs text-red-600 font-medium mt-1.5">Seleccioná un producto</p>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Fecha de producción</label>
          <input
            type="date"
            value={fechaProduccion}
            max={hoyPlanta()}
            onChange={(e) => setFechaProduccion(e.target.value)}
            className="w-full py-3 px-4 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Notas (opcional)</label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            placeholder="Observaciones sobre este lote..."
            className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none"
          />
        </div>
      </div>

      <p className="text-xs text-gray-400 px-1">
        El número de lote se genera automáticamente. Las reglas de numeración definitivas se van a definir más adelante.
      </p>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

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
                Creando...
              </span>
            ) : (
              "Dar de alta el lote"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
