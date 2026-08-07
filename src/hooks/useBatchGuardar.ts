"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clavesDeCaptura, type ClavesDeCaptura, type RegistroParaHuella } from "@/lib/calidad/idempotencia";
import { postConReintento } from "@/lib/calidad/envio-red";

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
          // El mensaje ya no promete que no se guardó nada: con idempotencia,
          // reintentar es seguro incluso si el servidor alcanzó a commitear.
          setError("Sin conexión con el servidor. Reintentá — si ya se guardó, no se va a duplicar.");
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

  return { enviando, error, exito, guardar };
}
