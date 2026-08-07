"use client";

/**
 * Implementación del puerto `Transporte`: postea al MISMO endpoint de batch que
 * usa el guardado online.
 *
 * No se crea un endpoint `/sync` aparte. Un solo camino de escritura significa un
 * solo lugar a auditar y un solo lugar donde puede aparecer un duplicado; dos
 * endpoints garantizan que en seis meses uno tenga la validación desactualizada.
 *
 * Adaptador puro: traduce la respuesta HTTP a `ResultadoIntento`. La decisión de
 * qué hacer con cada resultado vive en `cola.ts`.
 */

import { postConReintento } from "@/lib/calidad/envio-red";
import type { RegistroPendiente, ResultadoIntento, Transporte } from "./tipos";

export const transporteHttp: Transporte = {
  async enviar(
    registros: RegistroPendiente[],
    contexto: { capturadoEn: number }
  ): Promise<ResultadoIntento> {
    // Un solo intento por pasada: el reintento lo gobierna el backoff de la cola,
    // que sabe cuántas veces falló ESTA entrada y persiste ese contador entre
    // recargas de la app. El retry interno de postConReintento no lo sabe, y
    // apilar los dos multiplicaría los intentos sin control.
    const res = await postConReintento(
      "/api/v1/calidad/registros/batch",
      registros.map((r) => ({
        ...r,
        // Marca de procedencia: se capturó sin red y llegó con demora. El desvío
        // de reloj se evalúa en el servidor contra su propio createdAt.
        fuenteOrigen: "tablet_offline",
        // Instante real de captura. El servidor compara contra su propio
        // created_at para medir el desvío de reloj del dispositivo: una hora
        // puesta por la tablet es falsificable, y sin poder medir ese desvío la
        // calidad probatoria de todo el módulo se degrada.
        capturadoEn: new Date(contexto.capturadoEn).toISOString(),
      })),
      { maxIntentos: 1 }
    );

    if (res.ok) return { estado: "ok" };

    if (res.motivo === "red") return { estado: "sin_red" };

    // 5xx es del servidor y puede ser transitorio: se trata como falta de red
    // para que la entrada siga reintentando en vez de quedar bloqueada por un
    // deploy a mitad de camino o un pool saturado.
    if (res.status >= 500) return { estado: "sin_red" };

    // 401: la sesión venció. Reintentar no la renueva, pero bloquear la entrada
    // perdería el dato — el operario tiene que volver a loguearse y la cola
    // sigue intacta. Se trata como falta de red a propósito.
    if (res.status === 401) return { estado: "sin_red" };

    const json = res.json as { error?: string; code?: string } | null;
    return {
      estado: "rechazado",
      motivo: json?.error ?? `El servidor rechazó el registro (HTTP ${res.status})`,
    };
  },
};

export const relojSistema = {
  ahora: () => Date.now(),
};
