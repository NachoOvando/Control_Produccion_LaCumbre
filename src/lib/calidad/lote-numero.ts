// Generación del número de Lote administrativo (Lote.numeroLote) — reemplaza
// el placeholder GEN-{yyyyMMdd}-{HHmmss} (ver ADR-011). Lógica pura, sin
// dependencias de framework ni de Prisma; el caller (calidad.repository.ts)
// resuelve todos los inputs antes de llamar.
//
// NO confundir con generarLotePT (lote-pt.ts) — ese es el lote de Producto
// Terminado que va físicamente en el pallet, concepto distinto.
//
// Formato: L-DD/MM/AAAA-AJJJ-hh:mm-ENV
//   DD/MM/AAAA = fecha de VENCIMIENTO del producto (fechaProduccion + vidaUtilMeses)
//   AJJJ       = último dígito del año + día juliano (1-366), de la fecha de PRODUCCIÓN
//   hh:mm      = hora de planta en el momento de crear el registro del lote
//                ("hora de registro en sistema", NO hora real de inicio de
//                producción — aclaración explícita de scm-alimentos)
//   ENV        = código de línea productiva (LineaProductiva.codigo)
//
// Determinístico por minuto: dos lotes de la misma línea en el mismo minuto
// generan el mismo string. El caller (crearLote) le agrega un sufijo de
// desambiguación ("-02", "-03") en reintentos ante colisión real — ver
// calidad.repository.ts.
import { calcularFechaVencimiento } from "./lote-pt";

function diaJuliano(fecha: Date): number {
  const inicioAnio = new Date(fecha.getFullYear(), 0, 1);
  const msPorDia = 24 * 60 * 60 * 1000;
  return Math.round((fecha.getTime() - inicioAnio.getTime()) / msPorDia) + 1;
}

export function generarNumeroLote(input: {
  fechaProduccion: Date;
  vidaUtilMeses: number;
  lineaCodigo: number;
  horaRegistro: string; // "HH:mm", ya en hora de planta (ver horaPlanta())
  sufijo?: string;
}): string {
  const vencimiento = calcularFechaVencimiento(input.fechaProduccion, input.vidaUtilMeses);
  const dd = String(vencimiento.getDate()).padStart(2, "0");
  const mm = String(vencimiento.getMonth() + 1).padStart(2, "0");
  const aaaa = vencimiento.getFullYear();

  const ultimoDigitoAnio = input.fechaProduccion.getFullYear() % 10;
  const jjj = String(diaJuliano(input.fechaProduccion)).padStart(3, "0");

  const base = `L-${dd}/${mm}/${aaaa}-${ultimoDigitoAnio}${jjj}-${input.horaRegistro}-${input.lineaCodigo}`;
  return input.sufijo ? `${base}${input.sufijo}` : base;
}
