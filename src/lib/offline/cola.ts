/**
 * Política de la cola de sincronización offline. Módulo PURO: sin React, sin
 * IndexedDB, sin fetch, sin `Date.now()`. Todo entra por los puertos de
 * `tipos.ts`, así que esta lógica se testea completa con vitest.
 *
 * Escenario que cubre, y que es el DOMINANTE en planta: la app está abierta, el
 * WiFi se cae, el operario sigue capturando. No hace falta service worker para
 * eso — el SW solo cubre "la tablet se reinició sin red", que es real pero
 * secundario, y llega en el lote siguiente.
 *
 * Por qué esto es seguro y antes no lo era: cada registro lleva su
 * `clientRequestId` (ver lib/calidad/idempotencia.ts). Sin esa clave, una cola
 * que reintenta sola multiplicaría el bug de registros duplicados en vez de
 * arreglarlo — el orden de los dos cambios no era negociable.
 */

import type {
  ColaStore,
  EntradaCola,
  RegistroPendiente,
  Reloj,
  Transporte,
} from "./tipos";

/**
 * A partir de este tiempo pendiente, la ventana para corregir la corrida ya se
 * cerró: un ajuste de dosificador no sirve sobre producto que ya se envasó.
 * Umbral operativo definido por scm-alimentos, no técnico.
 */
export const UMBRAL_ALERTA_MS = 60 * 60 * 1000;

/** Backoff entre intentos de una misma entrada. Crece y se aplana en 5 min. */
export function esperaTrasIntentos(intentos: number): number {
  const escala = [5_000, 15_000, 60_000, 300_000];
  return escala[Math.min(intentos, escala.length - 1)];
}

/** Tope de entradas en la cola. Protege el budget de storage del dispositivo. */
export const MAX_ENTRADAS = 500;

export type EstadoCola = {
  /** Entradas esperando subir (excluye las bloqueadas). */
  pendientes: number;
  /** Entradas que el servidor rechazó y necesitan intervención humana. */
  bloqueadas: number;
  /** Milisegundos que lleva esperando la entrada MÁS VIEJA, o null si no hay. */
  antiguedadMaximaMs: number | null;
  /** ¿Alguna entrada pasó el umbral de acción operativa? */
  requiereAlerta: boolean;
};

/**
 * Estado agregado de la cola, para el contador permanente que el operario tiene
 * que ver sin buscarlo. Función pura sobre la lista de entradas.
 */
export function estadoDeCola(entradas: EntradaCola[], ahora: number): EstadoCola {
  const pendientes = entradas.filter((e) => !e.bloqueada);
  const bloqueadas = entradas.length - pendientes.length;

  let antiguedadMaximaMs: number | null = null;
  for (const e of pendientes) {
    // `capturadoEn` viene del reloj del dispositivo. Si el reloj se movió hacia
    // adelante entre la captura y ahora, la resta da negativo: se acota a 0 en vez
    // de mostrar una antigüedad absurda. El desvío real de reloj lo evalúa el
    // servidor contra su propio `created_at` al sincronizar.
    const edad = Math.max(0, ahora - e.capturadoEn);
    if (antiguedadMaximaMs === null || edad > antiguedadMaximaMs) antiguedadMaximaMs = edad;
  }

  return {
    pendientes: pendientes.length,
    bloqueadas,
    antiguedadMaximaMs,
    requiereAlerta: antiguedadMaximaMs !== null && antiguedadMaximaMs >= UMBRAL_ALERTA_MS,
  };
}

/** ¿Le toca reintentar a esta entrada, según su backoff? */
export function tocaReintentar(entrada: EntradaCola, ahora: number): boolean {
  if (entrada.bloqueada) return false;
  if (entrada.ultimoIntentoEn === null) return true;
  return ahora - entrada.ultimoIntentoEn >= esperaTrasIntentos(entrada.intentos);
}

/**
 * Orden de sincronización: por instante de captura, de más viejo a más nuevo.
 *
 * NO por cuándo se encoló ni por número de muestra. Es la misma razón por la que
 * todo reporte ordena por `fecha, hora`: el correlativo lo asigna el servidor al
 * sincronizar, así que subir en orden de captura es lo que hace que los
 * correlativos queden en el mismo orden en que se tomaron las muestras. Al
 * revés, un export ordenado por correlativo mostraría 10:15 antes de 09:40, y eso
 * solo ya es un hallazgo de auditoría aunque los datos estén bien.
 */
export function ordenarParaEnviar(entradas: EntradaCola[]): EntradaCola[] {
  return [...entradas].sort((a, b) => a.capturadoEn - b.capturadoEn);
}

export type Dependencias = {
  store: ColaStore;
  transporte: Transporte;
  reloj: Reloj;
  /** Genera el id de una entrada de cola. Inyectable para tests deterministas. */
  generarId?: () => string;
};

export type ResultadoEncolar =
  | { ok: true; id: string }
  | { ok: false; motivo: "cola_llena" };

/**
 * Encola una muestra completa como UNA unidad de trabajo.
 *
 * Los registros van juntos a propósito: el endpoint de batch es atómico, así que
 * una muestra de 12 filas sube completa o no sube. Encolar fila por fila dejaría
 * media muestra en la base ante un corte a mitad de sincronización.
 */
export async function encolar(
  registros: RegistroPendiente[],
  deps: Dependencias
): Promise<ResultadoEncolar> {
  const { store, reloj, generarId = () => crypto.randomUUID() } = deps;

  if (registros.length === 0) return { ok: false, motivo: "cola_llena" };

  const actuales = await store.contar();
  if (actuales >= MAX_ENTRADAS) return { ok: false, motivo: "cola_llena" };

  const entrada: EntradaCola = {
    id: generarId(),
    registros,
    capturadoEn: reloj.ahora(),
    intentos: 0,
    ultimoIntentoEn: null,
    ultimoError: null,
    bloqueada: false,
  };
  await store.guardar(entrada);
  return { ok: true, id: entrada.id };
}

export type ResultadoDrenar = {
  enviadas: number;
  fallidas: number;
  bloqueadas: number;
  /** true si se cortó por falta de red (no tiene sentido seguir intentando). */
  cortadoPorRed: boolean;
};

/**
 * Intenta subir todo lo que le toca, en orden de captura.
 *
 * Corta en el PRIMER fallo de red en vez de recorrer la cola entera: si no hay
 * red, el resto va a fallar igual, y seguir intentando solo consume batería y
 * marca todas las entradas con un intento más —lo que las empuja al backoff largo
 * justo cuando la red vuelva—.
 *
 * Un rechazo definitivo del servidor NO corta el drenado: es un problema de esa
 * entrada, no de la conexión, así que se la marca `bloqueada` y se sigue con las
 * demás. **Nunca se borra**: es un dato de calidad que alguien capturó, y
 * descartarlo en silencio sería perder un registro HACCP para simplificar la cola.
 */
export async function drenar(deps: Dependencias): Promise<ResultadoDrenar> {
  const { store, transporte, reloj } = deps;
  const ahora = reloj.ahora();

  const todas = await store.listar();
  const candidatas = ordenarParaEnviar(todas).filter((e) => tocaReintentar(e, ahora));

  let enviadas = 0;
  let fallidas = 0;
  let bloqueadas = 0;
  let cortadoPorRed = false;

  for (const entrada of candidatas) {
    const resultado = await transporte.enviar(entrada.registros, { capturadoEn: entrada.capturadoEn });

    if (resultado.estado === "ok") {
      await store.borrar(entrada.id);
      enviadas++;
      continue;
    }

    if (resultado.estado === "sin_red") {
      await store.guardar({
        ...entrada,
        intentos: entrada.intentos + 1,
        ultimoIntentoEn: reloj.ahora(),
        ultimoError: "Sin conexión con el servidor",
      });
      fallidas++;
      cortadoPorRed = true;
      break;
    }

    await store.guardar({
      ...entrada,
      intentos: entrada.intentos + 1,
      ultimoIntentoEn: reloj.ahora(),
      ultimoError: resultado.motivo,
      bloqueada: true,
    });
    bloqueadas++;
  }

  return { enviadas, fallidas, bloqueadas, cortadoPorRed };
}

/**
 * ¿Se puede cerrar el turno con esta cola?
 *
 * Regla dura de scm-alimentos, y el corte NO es un reloj sino el turno: **ningún
 * pallet se libera con registros de calidad pendientes de sincronizar**. Un
 * operario no puede terminar el turno sin saber que tiene muestras arriba del
 * dispositivo.
 *
 * Devuelve el motivo en lenguaje de planta, no un código.
 */
export function puedeCerrarTurno(estado: EstadoCola): { puede: boolean; motivo?: string } {
  if (estado.pendientes > 0) {
    return {
      puede: false,
      motivo:
        `Hay ${estado.pendientes} ${estado.pendientes === 1 ? "muestra" : "muestras"} sin subir. ` +
        `Conectá la tablet a la red antes de cerrar el turno — no se libera producto con registros pendientes.`,
    };
  }
  if (estado.bloqueadas > 0) {
    return {
      puede: false,
      motivo:
        `Hay ${estado.bloqueadas} ${estado.bloqueadas === 1 ? "muestra" : "muestras"} que el sistema rechazó. ` +
        `Avisá a supervisión de calidad: no se pueden subir sin revisarlas.`,
    };
  }
  return { puede: true };
}
