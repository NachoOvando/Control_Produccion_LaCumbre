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

// Vencimiento = fecha de producción + vida útil en meses, preservando el día
// del mes de producción (ej. producido el 16 → vence el 16 del mes destino).
// Si el mes destino no tiene ese día (31/01 + 1 mes), se clampea al último día
// de ese mes en vez de desbordar al mes siguiente (evita el bug de setMonth).
export function calcularFechaVencimiento(fechaProduccion: Date, vidaUtilMeses: number): Date {
  if (!Number.isInteger(vidaUtilMeses) || vidaUtilMeses <= 0) {
    throw new Error(`vidaUtilMeses inválido: ${vidaUtilMeses}`);
  }
  const dia = fechaProduccion.getDate();
  const totalMeses = fechaProduccion.getMonth() + vidaUtilMeses;
  const anio = fechaProduccion.getFullYear() + Math.floor(totalMeses / 12);
  const mes = totalMeses % 12; // 0-indexed, mes destino

  const ultimoDiaMesDestino = new Date(anio, mes + 1, 0).getDate();
  return new Date(anio, mes, Math.min(dia, ultimoDiaMesDestino));
}

// Formato MM/yyyy — usado hoy en Producción Diaria (el día no se muestra ahí,
// la vida útil real se mide en meses). Para el día completo (numeroLote de
// Lote administrativo), usar calcularFechaVencimiento directamente.
export function calcularVencimiento(fechaProduccion: Date, vidaUtilMeses: number): string {
  const vencimiento = calcularFechaVencimiento(fechaProduccion, vidaUtilMeses);
  const mes = String(vencimiento.getMonth() + 1).padStart(2, "0");
  return `${mes}/${vencimiento.getFullYear()}`;
}
