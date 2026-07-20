// Fuente única de "fecha y hora de planta" — usable en cliente y servidor.
// `toISOString()` da el día UTC: de 21:00 a 23:59 en Argentina (UTC-3) eso ya es
// "mañana", desalineando lo que el operador escribe con lo que el server lee
// como "hoy" (getRegistrosDelDia, correlativos, lote en curso). Intl con
// timeZone explícito no depende de la zona horaria configurada en el
// dispositivo ni del servidor.
export const TZ_PLANTA = "America/Argentina/Cordoba";

export function hoyPlanta(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ_PLANTA }).format(new Date());
}

export function horaPlanta(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_PLANTA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

// "Jornada productiva": corte de 24hs de 6am a 6am (no medianoche a medianoche),
// SOLO para decidir si corresponde generar un Lote administrativo nuevo dentro
// del find-or-create de activarProductoLinea (ver lote-numero.ts). El resto del
// módulo (registros del día, correlativo de pallets, turno) sigue usando
// hoyPlanta() sin cambios — no confundir ni unificar ambos conceptos.
// Un solo snapshot de fecha+hora vía formatToParts evita la ventana de
// milisegundos entre dos new Date() separados justo en el borde de medianoche.
export function jornadaProductiva(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_PLANTA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)!.value;

  const anio = Number(valor("year"));
  const mes = Number(valor("month"));
  const dia = Number(valor("day"));
  // Algunos locales devuelven "24" para la medianoche con hour12:false.
  const hora = Number(valor("hour")) % 24;

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (hora < 6) fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().slice(0, 10);
}
