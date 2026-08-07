"use client";

/**
 * Contador de muestras pendientes de subir.
 *
 * Es permanente y no se puede cerrar: un operario no puede terminar el turno sin
 * saber que tiene muestras arriba del dispositivo. Antes de esto, la app no tenía
 * NINGÚN indicador de estado de conexión — el operario descubría que no había red
 * recién al apretar Guardar, potencialmente después de 20 minutos de captura.
 *
 * Presentación pura: recibe el estado y no consulta la cola por su cuenta.
 */

import type { EstadoCola } from "@/lib/offline/cola";

function minutos(ms: number): number {
  return Math.floor(ms / 60_000);
}

export function IndicadorCola({
  estado,
  sincronizando,
  onSincronizar,
}: {
  estado: EstadoCola;
  sincronizando: boolean;
  onSincronizar: () => void;
}) {
  const { pendientes, bloqueadas, antiguedadMaximaMs, requiereAlerta } = estado;

  // Nada pendiente: no se muestra nada. Un badge verde permanente de "todo
  // sincronizado" se vuelve parte del fondo en dos turnos y deja de comunicar.
  if (pendientes === 0 && bloqueadas === 0) return null;

  const espera = antiguedadMaximaMs != null ? minutos(antiguedadMaximaMs) : 0;

  return (
    <div className="space-y-2">
      {pendientes > 0 && (
        <div
          className={`rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border ${
            requiereAlerta
              ? "bg-amber-50 border-amber-300"
              : "bg-blue-50 border-blue-200"
          }`}
        >
          <div className="min-w-0">
            <p className={`text-sm font-bold ${requiereAlerta ? "text-amber-900" : "text-blue-900"}`}>
              {pendientes} {pendientes === 1 ? "muestra sin subir" : "muestras sin subir"}
            </p>
            <p className={`text-xs leading-snug ${requiereAlerta ? "text-amber-700" : "text-blue-700"}`}>
              {requiereAlerta
                ? // Pasada esta ventana el ajuste de proceso ya no sirve: el
                  // producto de esa hora se envasó. El mensaje lo dice explícito
                  // para que el operario escale en vez de esperar.
                  `Esperando hace ${espera} min. Ya no se puede corregir la corrida — avisá a supervisión.`
                : "Guardadas en la tablet. Se suben solas al volver la red."}
            </p>
          </div>
          <button
            type="button"
            onClick={onSincronizar}
            disabled={sincronizando}
            className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all active:scale-95 disabled:opacity-50 ${
              requiereAlerta
                ? "bg-amber-500 text-white border-amber-600"
                : "bg-white text-blue-700 border-blue-300"
            }`}
          >
            {sincronizando ? "Subiendo..." : "Reintentar"}
          </button>
        </div>
      )}

      {bloqueadas > 0 && (
        <div className="rounded-2xl px-4 py-3 bg-red-50 border border-red-300">
          <p className="text-sm font-bold text-red-900">
            {bloqueadas} {bloqueadas === 1 ? "muestra rechazada" : "muestras rechazadas"} por el sistema
          </p>
          <p className="text-xs text-red-700 leading-snug">
            No se borraron: quedan guardadas en la tablet. Avisá a supervisión de
            calidad — hace falta revisarlas para poder subirlas.
          </p>
        </div>
      )}
    </div>
  );
}
