// Generación de lote PT y vencimiento a partir de la configuración del producto.
// Lógica pura, sin dependencias de framework — testeable de forma aislada.

// Tokens soportados en la nomenclatura de lote: {yyyyMMdd}, {ddMMyy}, {correlativo}
export function generarLotePT(template: string, fecha: Date, correlativo: number): string {
  const dd = String(fecha.getDate()).padStart(2, "0");
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const yyyy = String(fecha.getFullYear());
  const yy = yyyy.slice(2);

  return template
    .replaceAll("{yyyyMMdd}", `${yyyy}${mm}${dd}`)
    .replaceAll("{ddMMyy}", `${dd}${mm}${yy}`)
    .replaceAll("{correlativo}", String(correlativo).padStart(2, "0"));
}

// Vencimiento = fecha de producción + vida útil en meses, formato MM/yyyy.
// Se calcula el mes en forma directa (sin pasar por el día) para evitar el
// overflow de setMonth: 31/05 + 9 meses NO debe normalizar a marzo.
export function calcularVencimiento(fechaProduccion: Date, vidaUtilMeses: number): string {
  if (!Number.isInteger(vidaUtilMeses) || vidaUtilMeses <= 0) {
    throw new Error(`vidaUtilMeses inválido: ${vidaUtilMeses}`);
  }
  const totalMeses = fechaProduccion.getMonth() + vidaUtilMeses;
  const anio = fechaProduccion.getFullYear() + Math.floor(totalMeses / 12);
  const mes = (totalMeses % 12) + 1;
  return `${String(mes).padStart(2, "0")}/${anio}`;
}
