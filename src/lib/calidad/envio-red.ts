/**
 * Política de reintento y timeout para el guardado de registros de calidad.
 *
 * Contexto: el WiFi de planta se degrada, no solo se cae. Antes de este módulo
 * el `fetch` del guardado no tenía timeout ni cancelación, así que con señal
 * débil el botón quedaba en "Guardando..." indefinidamente y el operario no
 * tenía salida.
 *
 * Reintentar solo es seguro porque el guardado ya es idempotente
 * (`clientRequestId`, ver lib/calidad/idempotencia.ts). Sin esa clave, un retry
 * automático multiplicaría el bug de duplicados en vez de arreglarlo — el orden
 * de estos dos cambios no es negociable.
 *
 * Módulo puro: sin React. `fetch` y el temporizador se inyectan para testear.
 */

export const TIMEOUT_MS = 15_000;
export const MAX_INTENTOS = 3;

/** Backoff con crecimiento geométrico: 400ms, 1200ms. Sin jitter — no hay
 * escala de clientes concurrentes que justifique dispersar (una línea tiene una
 * tablet), y el determinismo hace el test trivial. */
export function esperaAntesDeIntento(intento: number): number {
  return 400 * 3 ** (intento - 1);
}

/**
 * ¿Vale la pena reintentar este resultado?
 *
 * - Error de red / timeout → SÍ. Es el caso que este módulo existe para cubrir.
 * - 5xx → SÍ. El servidor falló de forma potencialmente transitoria.
 * - 4xx → NO. Validación, autorización o conflicto: reintentar el mismo payload
 *   va a fallar igual y solo demora el mensaje al operario.
 * - 2xx → NO, ya está.
 *
 * El 401 es un 4xx a propósito: si la sesión venció, reintentar no la renueva.
 */
export function debeReintentar(resultado: { tipo: "red" } | { tipo: "http"; status: number }): boolean {
  if (resultado.tipo === "red") return true;
  return resultado.status >= 500;
}

export type ResultadoEnvio =
  | { ok: true; status: number; json: unknown }
  | { ok: false; motivo: "red"; intentos: number }
  | { ok: false; motivo: "http"; status: number; json: unknown };

type Dependencias = {
  fetchImpl?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxIntentos?: number;
};

/**
 * POST con timeout por intento y reintento con backoff.
 *
 * Cada intento tiene su propio `AbortController`: un intento colgado se corta a
 * los `timeoutMs` y libera el siguiente, en vez de bloquear la cadena entera.
 */
export async function postConReintento(
  url: string,
  body: unknown,
  deps: Dependencias = {}
): Promise<ResultadoEnvio> {
  const {
    fetchImpl = fetch,
    dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
    timeoutMs = TIMEOUT_MS,
    maxIntentos = MAX_INTENTOS,
  } = deps;

  let ultimoFalloDeRed = 0;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    const controller = new AbortController();
    const temporizador = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // El json puede fallar si el servidor devolvió HTML (proxy, 502 de
      // infraestructura). No debe enmascarar el status real.
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (res.ok) return { ok: true, status: res.status, json };

      if (!debeReintentar({ tipo: "http", status: res.status }) || intento === maxIntentos) {
        return { ok: false, motivo: "http", status: res.status, json };
      }
    } catch {
      // Falla de red o abort por timeout. `AbortError` y `TypeError: fetch
      // failed` se tratan igual: desde el punto de vista del operario, no hubo
      // respuesta.
      ultimoFalloDeRed = intento;
      if (intento === maxIntentos) {
        return { ok: false, motivo: "red", intentos: intento };
      }
    } finally {
      clearTimeout(temporizador);
    }

    await dormir(esperaAntesDeIntento(intento));
  }

  return { ok: false, motivo: "red", intentos: ultimoFalloDeRed || maxIntentos };
}
