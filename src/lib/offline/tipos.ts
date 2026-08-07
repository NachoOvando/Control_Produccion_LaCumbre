/**
 * Contratos de la cola de sincronización offline.
 *
 * Los tres puertos (store, transporte, reloj) se definen acá para que
 * `cola.ts` —donde vive la política— no importe IndexedDB, `fetch` ni
 * `Date.now()`. Eso es lo que permite testear la política completa con vitest,
 * sin JSDOM y sin base de datos.
 */

/** Un registro de calidad listo para enviar, tal como lo arma el formulario. */
export type RegistroPendiente = {
  /** Clave de idempotencia (UUID v4 del dispositivo). Es también la PK en la cola. */
  clientRequestId: string;
  puntoControlId: string;
  loteId: string;
  lineaProductivaId: string;
  fecha: string;
  hora: string;
  nroMuestra: number;
  filaProd?: number;
  notas?: string;
  data: Record<string, unknown>;
};

/**
 * Un lote de registros encolado como una sola unidad de trabajo.
 *
 * El agrupamiento importa: el endpoint de batch es atómico, así que una muestra
 * de 12 filas tiene que subir junta o no subir. Si se encolara fila por fila, un
 * corte a mitad de sincronización dejaría media muestra en la base — peor que no
 * haber subido nada.
 */
export type EntradaCola = {
  /** Id de la entrada de cola. Distinto de los clientRequestId que contiene. */
  id: string;
  registros: RegistroPendiente[];
  /** Instante de captura (epoch ms, reloj del DISPOSITIVO). */
  capturadoEn: number;
  /** Intentos de envío ya realizados. */
  intentos: number;
  /** Instante del último intento fallido, para el backoff. */
  ultimoIntentoEn: number | null;
  /** Motivo del último fallo, para mostrarle algo concreto al operario. */
  ultimoError: string | null;
  /**
   * Marcada como no reintentable: el servidor la rechazó por una razón que no se
   * arregla reintentando (validación, lote inexistente). Queda en la cola para
   * que el supervisor la vea, NO se borra en silencio — es un dato de calidad
   * que alguien capturó.
   */
  bloqueada: boolean;
};

/** Puerto de persistencia. La implementación real usa IndexedDB vía `idb`. */
export type ColaStore = {
  listar(): Promise<EntradaCola[]>;
  guardar(entrada: EntradaCola): Promise<void>;
  borrar(id: string): Promise<void>;
  contar(): Promise<number>;
};

/** Resultado de intentar subir una entrada. */
export type ResultadoIntento =
  | { estado: "ok" }
  /** Falló por red: reintentable, no consume la entrada. */
  | { estado: "sin_red" }
  /** El servidor respondió un error definitivo: no reintentar. */
  | { estado: "rechazado"; motivo: string };

/**
 * Puerto de red. La implementación real postea al batch existente.
 *
 * Recibe el `capturadoEn` de la ENTRADA, no de cada registro: el instante de
 * captura es de la muestra completa (las 12 filas se tomaron juntas), y el
 * servidor lo necesita para calcular el desvío de reloj contra su propio
 * `created_at`.
 */
export type Transporte = {
  enviar(
    registros: RegistroPendiente[],
    contexto: { capturadoEn: number }
  ): Promise<ResultadoIntento>;
};

/** Puerto de tiempo. Inyectable para que los tests sean deterministas. */
export type Reloj = {
  ahora(): number;
};
