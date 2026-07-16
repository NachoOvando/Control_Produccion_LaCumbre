"use client";
import { hoyPlanta, horaPlanta } from "@/lib/calidad/fecha-planta";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProductoActivoBanner } from "@/components/calidad/ProductoActivoBanner";
import type { ProductoActivoLinea } from "@/types/calidad";

/**
 * Formulario genérico para puntos de control que no tienen UI especializada.
 * Renderiza los campos del JSON Schema como inputs básicos.
 * Útil para probar nuevos puntos de control antes de crear su UI específica.
 */

type JsonSchemaProperty = {
  type: string;
  enum?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
};

type JsonSchema = {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

type Props = {
  puntoControlId: string;
  puntoControlNombre: string;
  lineaProductivaId: string;
  schemaJson: object;
  productoActivo: ProductoActivoLinea;
};

export function RegistroGenericoForm({ puntoControlId, puntoControlNombre, lineaProductivaId, schemaJson, productoActivo }: Props) {
  const router = useRouter();
  const schema = schemaJson as JsonSchema;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  const loteId = productoActivo.loteId;
  const [hora, setHora] = useState(horaPlanta());
  const [notas, setNotas] = useState("");
  const [data, setData] = useState<Record<string, string | boolean>>({});
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const guardar = async () => {
    setEnviando(true);
    setError(null);

    // Convertir valores según tipo del schema
    const dataConvertida: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(properties)) {
      const val = data[key];
      if (val === undefined || val === "") {
        dataConvertida[key] = undefined;
        continue;
      }
      if (prop.type === "number" || prop.type === "integer") {
        dataConvertida[key] = parseFloat(val as string);
      } else if (prop.type === "boolean") {
        dataConvertida[key] = val === "true" || val === true;
      } else {
        dataConvertida[key] = val;
      }
    }

    const payload = {
      puntoControlId,
      loteId,
      lineaProductivaId,
      responsableId: "00000000-0000-0000-0000-000000000000",
      fecha: hoyPlanta(),
      hora: hora + ":00",
      nroMuestra: 1,
      notas: notas || undefined,
      data: dataConvertida,
    };

    try {
      const res = await fetch("/api/v1/calidad/registros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (json.error) {
        setError(json.error + (json.details ? `: ${JSON.stringify(json.details)}` : ""));
        return;
      }

      setExito(true);
      setTimeout(() => router.push("/calidad"), 2000);
    } catch {
      setError("Error de conexión. Intentá nuevamente.");
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
        <h2 className="text-xl font-bold text-gray-900">Registro guardado</h2>
        <p className="text-gray-500 text-sm">Volviendo al módulo de Calidad...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Producto en producción */}
      <div onClick={(e) => e.stopPropagation()}>
        <ProductoActivoBanner productoActivo={productoActivo} lineaId={lineaProductivaId} />
      </div>

      {/* Hora */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Hora</label>
        <input
          type="time"
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none"
        />
      </div>

      {/* Campos del schema */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4">
        <h2 className="text-sm font-bold text-gray-700">{puntoControlNombre}</h2>
        {Object.entries(properties).map(([key, prop]) => {
          const esRequerido = required.includes(key);
          const label = prop.description ?? key;

          return (
            <div key={key}>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                {label} {esRequerido && <span className="text-red-500">*</span>}
              </label>

              {prop.enum ? (
                <div className="flex flex-wrap gap-2">
                  {prop.enum.map((opcion) => (
                    <button
                      key={opcion}
                      type="button"
                      onClick={() => setData((d) => ({ ...d, [key]: opcion }))}
                      className={`
                        px-3 py-2 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95
                        ${data[key] === opcion
                          ? "bg-[#E1000F] text-white border-[#E1000F] shadow"
                          : "bg-gray-100 text-gray-700 border-gray-200"
                        }
                      `}
                    >
                      {opcion}
                    </button>
                  ))}
                </div>
              ) : prop.type === "boolean" ? (
                <button
                  type="button"
                  onClick={() => setData((d) => ({ ...d, [key]: !(d[key] as boolean) }))}
                  className={`
                    px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all
                    ${data[key]
                      ? "bg-[#E1000F] text-white border-[#E1000F]"
                      : "bg-gray-100 text-gray-700 border-gray-200"
                    }
                  `}
                >
                  {data[key] ? "Sí" : "No"}
                </button>
              ) : (
                <input
                  type="number"
                  inputMode="decimal"
                  value={data[key] as string ?? ""}
                  onChange={(e) => setData((d) => ({ ...d, [key]: e.target.value }))}
                  min={prop.minimum}
                  max={prop.maximum}
                  className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none"
                  placeholder={prop.minimum !== undefined ? `${prop.minimum} – ${prop.maximum}` : ""}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Notas */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notas</label>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          className="w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none resize-none"
          placeholder="Observaciones opcionales..."
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-20">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={guardar}
            disabled={enviando}
            className="w-full py-4 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 transition-all shadow-lg shadow-red-200"
          >
            {enviando ? "Guardando..." : "Guardar registro"}
          </button>
        </div>
      </div>
    </div>
  );
}
