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
