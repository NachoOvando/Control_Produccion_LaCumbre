"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clavesDeCaptura, type ClavesDeCaptura, type RegistroParaHuella } from "@/lib/calidad/idempotencia";
import { postConReintento } from "@/lib/calidad/envio-red";
import { useColaSincronizacion } from "@/hooks/useColaSincronizacion";
import type { RegistroPendiente } from "@/lib/offline/tipos";

/**
 * Guardado en batch de registros de calidad, idempotente y con reintento.
 *
 * Este hook es un adaptador de React: la lógica vive en dos módulos puros y
 * testeables sin montar React —
 *   - lib/calidad/idempotencia.ts: identidad del evento de captura.
 *   - lib/calidad/envio-red.ts: timeout, cancelación y política de reintento.
 *
 * Por qué importa el orden de esas dos cosas: reintentar automáticamente sin
 * clave de idempotencia multiplicaría el bug de registros duplicados en vez de
 * arreglarlo.
 */
export function useBatchGuardar(redirectTo = "/calidad", onExito?: () => void) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  // Claves del último intento. Se conservan mientras el guardado no haya
  // salido bien, para que un reintento del MISMO contenido reuse las claves y el
  // servidor lo reconozca como el mismo evento de captura. Si el operario
  // corrige un valor antes de reintentar, la huella cambia y se generan claves
  // nuevas — así la corrección no se pierde en silencio.
  const clavesRef = useRef<ClavesDeCaptura | null>(null);

  // Cola durable en IndexedDB. Se expone hacia afuera para que el formulario
  // pueda mostrar el contador de pendientes sin montar el hook por su cuenta.
  const { estado: colaEstado, sincronizando, sincronizar, encolarMuestra } = useColaSincronizacion();

  const guardar = async (registros: Record<string, unknown>[]): Promise<boolean> => {
    setEnviando(true);
    setError(null);

    const claves = clavesDeCaptura(registros as unknown as RegistroParaHuella[], clavesRef.current);
    clavesRef.current = claves;

    const payload = registros.map((r, i) => ({ ...r, clientRequestId: claves.claves[i] }));

    try {
      const res = await postConReintento("/api/v1/calidad/registros/batch", payload);

      if (!res.ok) {
        if (res.motivo === "red") {
          // Sin red la muestra NO se pierde: se guarda en la cola durable de la
          // tablet y se sube sola cuando la red vuelve. Es seguro reintentar
          // incluso si el servidor alcanzó a commitear, porque cada registro
          // lleva su clientRequestId.
          const encolada = await encolarMuestra(payload as unknown as RegistroPendiente[]);

          if (encolada.ok) {
            // Se trata como éxito a propósito: para el operario el dato está
            // resguardado y puede seguir con la muestra siguiente. Decirle
            // "error" acá lo empujaría a reintentar a mano una y otra vez sobre
            // algo que ya está a salvo.
            clavesRef.current = null;
            setExito(true);
            onExito?.();
            setTimeout(() => router.push(redirectTo), 2000);
            return true;
          }

          // La cola no aceptó la muestra (storage lleno o no disponible). Acá sí
          // hay que frenar al operario: el dato solo existe en la pantalla.
          setError(
            "Sin conexión y la tablet no puede guardar más muestras. NO cierres esta pantalla — " +
              "avisá a supervisión antes de seguir."
          );
        } else {
          const json = res.json as { error?: string } | null;
          setError(json?.error ?? "Error al guardar los registros.");
        }
        return false;
      }

      // Éxito: se descartan las claves para que la próxima muestra sea un evento
      // de captura nuevo.
      clavesRef.current = null;
      setExito(true);
      onExito?.();
      setTimeout(() => router.push(redirectTo), 2000);
      return true;
    } finally {
      setEnviando(false);
    }
  };

  return { enviando, error, exito, guardar, colaEstado, sincronizando, sincronizar };
}
