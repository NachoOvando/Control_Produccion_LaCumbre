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
