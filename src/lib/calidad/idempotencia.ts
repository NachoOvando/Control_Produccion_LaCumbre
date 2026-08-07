/**
 * Identidad del evento de captura — clave de idempotencia del guardado.
 *
 * Problema que resuelve: el batch commitea, el WiFi de planta se corta antes de
 * que vuelva la respuesta, el operario ve un error de conexión y vuelve a tocar
 * Guardar. Sin una identidad estable, el reintento crea un segundo juego de
 * registros con correlativo consecutivo (ver `clientRequestId` en
 * prisma/schema.prisma).
 *
 * Las dos propiedades que esta identidad tiene que cumplir, y que están en
 * tensión:
 *
 *   1. ESTABLE entre reintentos del mismo dato. Si el operario toca Guardar
 *      dos veces con los mismos valores, el servidor tiene que reconocer el
 *      segundo intento como el mismo evento.
 *
 *   2. DISTINTA si el operario corrigió los valores. Si tras el error edita una
 *      medición y reenvía, reusar la clave haría que el servidor responda "ya
 *      existe" y la corrección se perdería en silencio — el peor resultado
 *      posible. Con clave nueva quedan los dos registros, y que ambos sean
 *      visibles es lo que HACCP quiere: una corrección es trazable, no un
 *      reemplazo.
 *
 * Se resuelve con una huella del CONTENIDO capturado. Qué queda afuera de la
 * huella y por qué:
 *
 *   - `hora`: los formularios la recalculan al momento de enviar, así que
 *     cambia sola entre un intento y el reintento 40 segundos después. Incluirla
 *     rompería la propiedad 1 en el caso más común. Es exactamente el motivo por
 *     el que se descartó el índice único que proponía ADR-017 sobre `hora`.
 *   - `nroMuestra`: el servidor lo descarta y lo reasigna desde
 *     `secuencias_diarias` (ADR-006). No es parte del dato capturado.
 *   - `fecha`: sí entra. Un cambio de fecha es un evento de captura distinto.
 *
 * Módulo puro: sin React, sin fetch, sin acceso a storage. `crypto.randomUUID`
 * se inyecta para poder testear de forma determinista.
 */

export type RegistroParaHuella = {
  puntoControlId: string;
  loteId: string;
  lineaProductivaId: string;
  fecha: string;
  filaProd?: number;
  notas?: string;
  data: Record<string, unknown>;
};

/**
 * Huella estable del contenido de un batch. Dos batches con el mismo contenido
 * capturado producen la misma huella, independientemente de la hora de envío.
 *
 * Las claves de cada objeto se ordenan antes de serializar: `JSON.stringify`
 * respeta el orden de inserción, y un formulario que arme el mismo objeto con
 * las claves en otro orden produciría una huella distinta para el mismo dato.
 */
export function huellaDeBatch(registros: RegistroParaHuella[]): string {
  return JSON.stringify(registros.map(normalizarParaHuella));
}

function normalizarParaHuella(r: RegistroParaHuella): unknown {
  return [
    r.puntoControlId,
    r.loteId,
    r.lineaProductivaId,
    r.fecha,
    r.filaProd ?? null,
    r.notas ?? null,
    ordenarProfundo(r.data),
  ];
}

// Ordena recursivamente las claves de los objetos para que la serialización no
// dependa del orden de inserción. Los arrays conservan su orden: en las
// mediciones el orden ES el dato (posición = pico dosificador).
function ordenarProfundo(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarProfundo);
  if (valor === null || typeof valor !== "object") return valor;
  const entradas = Object.entries(valor as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return entradas.map(([k, v]) => [k, ordenarProfundo(v)]);
}

export type ClavesDeCaptura = {
  /** Huella del contenido con el que se generaron estas claves. */
  huella: string;
  /** Un UUID por registro, en el mismo orden que el batch. */
  claves: string[];
};

/**
 * Devuelve las claves de idempotencia para un batch, reusando las anteriores si
 * el contenido no cambió.
 *
 * Un UUID POR REGISTRO y no uno por batch: si algún día un reintento parcial
 * llega a existir, la deduplicación tiene que poder resolverse fila por fila.
 *
 * @param previas Claves del intento anterior, o null si es el primer intento
 *                (o si el anterior terminó en éxito y ya se descartaron).
 */
export function clavesDeCaptura(
  registros: RegistroParaHuella[],
  previas: ClavesDeCaptura | null,
  generarUuid: () => string = () => crypto.randomUUID()
): ClavesDeCaptura {
  const huella = huellaDeBatch(registros);

  // Reintento del mismo contenido: se reusan las claves para que el servidor lo
  // reconozca como el mismo evento de captura.
  if (previas && previas.huella === huella && previas.claves.length === registros.length) {
    return previas;
  }

  return { huella, claves: registros.map(() => generarUuid()) };
}
