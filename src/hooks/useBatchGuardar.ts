"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function useBatchGuardar(redirectTo = "/calidad", onExito?: () => void) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const guardar = async (registros: Record<string, unknown>[]): Promise<boolean> => {
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
        return false;
      }
      setExito(true);
      onExito?.();
      setTimeout(() => router.push(redirectTo), 2000);
      return true;
    } catch {
      setError("Error de conexión. Verificá la red e intentá de nuevo.");
      return false;
    } finally {
      setEnviando(false);
    }
  };

  return { enviando, error, exito, guardar };
}
