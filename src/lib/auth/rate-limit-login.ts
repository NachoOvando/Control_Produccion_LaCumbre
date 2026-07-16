// Rate limiting de login, en memoria de proceso — auditoría 2026-07, deuda #10.
//
// - Por email: 5 fallos en 15 min bloquean nuevos intentos con ese email
//   (bloqueo duro). Riesgo residual aceptado: quien conoce el email de un
//   tercero puede bloquearlo 15 min — se mitiga con el log de detección.
// - Por IP: 30 fallos en 15 min marcan la IP como sospechosa. SOLO DETECCIÓN
//   (log), NUNCA bloqueo: en esta topología (single-instance, sin reverse
//   proxy) la IP sale de headers que el cliente puede falsificar
//   (x-forwarded-for llega tal cual lo mande un curl — verificado), y además
//   los navegadores sin header comparten el bucket "desconocida". Bloquear
//   por una clave así permitiría tumbar el login de toda la planta con 30
//   requests (hallazgo Alto de seguridad-analista 2026-07-16). Si algún día
//   hay un proxy confiable delante, recién ahí evaluar bloqueo por IP real.
//
// Suficiente para el deploy single-instance de planta interna; si se escala
// horizontal, migrar a un guard basado en DB (mismo patrón que
// verificarLimiteActivaciones en linea-producto-activo.service.ts).

export const MAX_INTENTOS_EMAIL = 5;
export const UMBRAL_SOSPECHA_IP = 30;
export const VENTANA_BLOQUEO_MS = 15 * 60_000;

type RegistroFallos = { fallos: number; primerFalloEn: number };

const fallosPorEmail = new Map<string, RegistroFallos>();
const fallosPorIp = new Map<string, RegistroFallos>();

function fallosVigentes(
  mapa: Map<string, RegistroFallos>,
  clave: string,
  ahora: number
): number {
  const registro = mapa.get(clave);
  if (!registro) return 0;
  if (ahora - registro.primerFalloEn > VENTANA_BLOQUEO_MS) {
    mapa.delete(clave);
    return 0;
  }
  return registro.fallos;
}

function sumarFallo(
  mapa: Map<string, RegistroFallos>,
  clave: string,
  ahora: number
): number {
  const registro = mapa.get(clave);
  if (!registro || ahora - registro.primerFalloEn > VENTANA_BLOQUEO_MS) {
    mapa.set(clave, { fallos: 1, primerFalloEn: ahora });
    return 1;
  }
  registro.fallos += 1;
  return registro.fallos;
}

/** true si el email está bloqueado (única condición que rechaza intentos). */
export function loginBloqueado(email: string, ahora: number = Date.now()): boolean {
  return fallosVigentes(fallosPorEmail, email, ahora) >= MAX_INTENTOS_EMAIL;
}

/**
 * Registra un fallo en ambos contadores. Los flags son true SOLO en el fallo
 * exacto que cruza cada umbral — para loguear la transición una sola vez,
 * no una línea por cada intento posterior (el log de detección no debe ser
 * él mismo floodeable).
 */
export function registrarFalloLogin(
  email: string,
  ip: string,
  ahora: number = Date.now()
): { emailBloqueado: boolean; ipSospechosa: boolean } {
  return {
    emailBloqueado: sumarFallo(fallosPorEmail, email, ahora) === MAX_INTENTOS_EMAIL,
    ipSospechosa: sumarFallo(fallosPorIp, ip, ahora) === UMBRAL_SOSPECHA_IP,
  };
}

/** Login exitoso: se limpia el contador del email. El de IP expira solo por
 * ventana — un atacante no debe poder resetear su cuota acertando con SU
 * propia cuenta entre medio del spray. */
export function limpiarFallosDeEmail(email: string) {
  fallosPorEmail.delete(email);
}

/** Solo para tests. */
export function resetRateLimitLogin() {
  fallosPorEmail.clear();
  fallosPorIp.clear();
}
