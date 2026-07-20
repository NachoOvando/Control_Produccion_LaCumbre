"use client";

import { useCallback, useEffect, useState } from "react";

export type RegistroDelDia = {
  id: string;
  hora: string;
  nroMuestra: number | null;
  notas: string | null;
  data: Record<string, unknown>;
  responsable: { id: string; nombre: string } | null;
  lote: { numeroLote: string } | null;
  turno: { id: string; nombre: string } | null;
};

// Fetch de los registros de HOY para un punto de control + línea.
//
// El modo demo real es transparente para este hook: GET /api/v1/calidad/registros
// solo cae a lista vacía sin avisar cuando DEMO_MODE=true en el servidor
// (200 { data: [] }), indistinguible a propósito de "día sin registros" real.
// esDemo NUNCA se deriva de un fallo de fetch — un 401/500/503 (DB_NO_DISPONIBLE,
// que el servidor devuelve precisamente cuando DEMO_MODE NO está activo) o una
// excepción de red es siempre un error real, nunca "modo demo". Igualar ambos
// casos rompía C5: los formularios derivan nroMuestra/pallet_numero de esta
// lista, y un error real no debe reiniciar un correlativo de negocio en 1.
export function useRegistrosDelDia(
  puntoControlId: string,
  lineaProductivaId: string,
  refreshKey = 0,
  enabled = true
) {
  const [registros, setRegistros] = useState<RegistroDelDia[]>([]);
  const [cargando, setCargando] = useState(enabled);
  const [esDemo, setEsDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/calidad/registros?lineaProductivaId=${encodeURIComponent(lineaProductivaId)}&puntoControlId=${encodeURIComponent(puntoControlId)}`
      );
      if (!res.ok) {
        // Error real del servidor (401, 500, 503 DB_NO_DISPONIBLE, etc.):
        // no hay "modo demo" posible acá, la API solo cae a demo devolviendo
        // 200 OK. Se preserva `registros` anterior en vez de vaciarlo para no
        // alimentar un correlativo con una lista vacía espuria.
        setEsDemo(false);
        setError("No se pudieron cargar los registros de hoy. Reintentá.");
        return;
      }
      const json = await res.json();
      setRegistros(Array.isArray(json.data) ? json.data : []);
      setEsDemo(false);
    } catch {
      // Fallo de red: mismo criterio, error real, no demo.
      setEsDemo(false);
      setError("No se pudieron cargar los registros de hoy. Reintentá.");
    } finally {
      setCargando(false);
    }
  }, [puntoControlId, lineaProductivaId]);

  useEffect(() => {
    if (!enabled) return;
    void cargar();
    // refreshKey fuerza recarga tras un guardado exitoso
  }, [cargar, refreshKey, enabled]);

  return { registros, cargando, esDemo, error, recargar: cargar };
}

type Props = {
  puntoControlId: string;
  lineaProductivaId: string;
  refreshKey?: number;
  titulo?: string;
  renderItem?: (registro: RegistroDelDia) => React.ReactNode;
  // Si el form ya usa useRegistrosDelDia, pasar los registros acá evita un doble fetch
  registros?: RegistroDelDia[];
  cargando?: boolean;
  esDemo?: boolean;
  error?: string | null;
  onReintentar?: () => void;
};

function resumenData(data: Record<string, unknown>): string {
  const partes: string[] = [];
  for (const [key, valor] of Object.entries(data)) {
    if (valor === null || valor === undefined || valor === "") continue;
    if (Array.isArray(valor)) {
      partes.push(`${key}: ${valor.length} valores`);
    } else if (typeof valor === "object") {
      continue;
    } else {
      partes.push(`${key}: ${String(valor)}`);
    }
    if (partes.length >= 4) break;
  }
  return partes.join(" · ");
}

export function RegistrosDelDia({
  puntoControlId,
  lineaProductivaId,
  refreshKey = 0,
  titulo = "Registros de hoy",
  renderItem,
  registros: registrosProp,
  cargando: cargandoProp,
  esDemo: esDemoProp,
  error: errorProp,
  onReintentar,
}: Props) {
  // Si vienen registros por prop, el fetch interno se desactiva por completo (evita doble request)
  const interno = useRegistrosDelDia(puntoControlId, lineaProductivaId, refreshKey, !registrosProp);

  const registros = registrosProp ?? interno.registros;
  const cargando = cargandoProp ?? (registrosProp ? false : interno.cargando);
  const esDemo = esDemoProp ?? (registrosProp ? false : interno.esDemo);
  const error = errorProp ?? (registrosProp ? null : interno.error);
  const reintentar = onReintentar ?? (registrosProp ? undefined : interno.recargar);

  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{titulo}</h2>
        {registros.length > 0 && (
          <span className="text-xs font-semibold text-gray-400">
            {registros.length} {registros.length === 1 ? "registro" : "registros"}
          </span>
        )}
      </div>

      {cargando ? (
        <div className="space-y-2">
          <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
        </div>
      ) : error ? (
        <div className="text-center py-6">
          <p className="text-sm font-medium text-[#E1000F]">{error}</p>
          {reintentar && (
            <button
              type="button"
              onClick={() => void reintentar()}
              className="mt-2 text-xs font-semibold text-[#E1000F] hover:underline"
            >
              Reintentar
            </button>
          )}
        </div>
      ) : registros.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <p className="text-sm font-medium">Sin registros hoy</p>
          {esDemo && (
            <p className="text-xs mt-1">Modo demo — los registros se mostrarán al conectar la base de datos</p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {registros.map((r) => (
            <li key={r.id} className="py-2.5">
              {renderItem ? (
                renderItem(r)
              ) : (
                <div className="flex items-start gap-3">
                  <span className="text-xs font-mono font-semibold text-gray-500 bg-gray-100 rounded-lg px-2 py-1 shrink-0">
                    {r.hora?.slice(0, 5) ?? "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">{resumenData(r.data)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {r.responsable?.nombre ?? "—"}
                      {r.lote?.numeroLote ? ` · Lote ${r.lote.numeroLote}` : ""}
                      {r.turno?.nombre ? ` · ${r.turno.nombre}` : ""}
                    </p>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
