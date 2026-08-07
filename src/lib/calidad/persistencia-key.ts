/**
 * Key de sessionStorage para el progreso en curso de un formulario de
 * captura de calidad. Escopeada a (línea, lote activo, punto de control):
 * un changeover de producto activa un lote nuevo → key distinta → el
 * progreso viejo nunca se lee ni se mezcla con el lote nuevo.
 */
export function claveProgresoMuestras(params: {
  lineaProductivaId: string;
  loteId: string;
  puntoControlId: string;
}): string {
  const { lineaProductivaId, loteId, puntoControlId } = params;
  return `calidad:muestras:${lineaProductivaId}:${loteId}:${puntoControlId}`;
}

/**
 * Key del borrador del alta MANUAL de lote (`/calidad/lotes/nuevo`). No puede
 * usar `claveProgresoMuestras`: ese formulario existe justamente para crear el
 * lote, así que no hay `loteId` todavía, ni línea ni punto de control.
 *
 * Es una key fija: hay un solo borrador de alta de lote a la vez por pestaña.
 */
export const CLAVE_BORRADOR_ALTA_LOTE = "calidad:alta-lote:borrador";
