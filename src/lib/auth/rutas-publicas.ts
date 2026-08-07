/**
 * Rutas que se sirven SIN sesión: los assets de la PWA y la pantalla de fallback
 * sin conexión.
 *
 * ── Por qué esto es una función y no una exclusión en el `matcher` ───────────
 *
 * El primer intento fue agregarlas al `matcher` del middleware. No funciona, y el
 * modo de falla es de los peores: **el `matcher` de Next NO es un regex de JS**,
 * lo procesa `path-to-regexp`. Un lookahead negativo simple sí anda (es el patrón
 * que documenta Next), pero al anclar las exclusiones con `$` para que
 * `offline` no matcheara también `/offline-config`, path-to-regexp produjo en
 * silencio —sin ninguna advertencia en el build ni en runtime— un matcher que
 * capturaba TODO. Resultado: `/sw.js`, `/manifest.webmanifest` y `/offline`
 * pasaron a devolver 302 al login, o sea el service worker no se registraba y la
 * PWA quedaba inerte.
 *
 * Peor todavía: un test que evaluara ese matcher como regex de JS pasaba en verde
 * mientras producción hacía otra cosa. Un test con falsa confianza es peor que no
 * tener test.
 *
 * Así que la decisión se saca del regex y se pone en JS, dentro del callback
 * `authorized` (ver src/lib/auth.config.ts). Cuesta que estos pedidos pasen por
 * el middleware —overhead despreciable— y a cambio la comparación es EXACTA,
 * legible y testeable con la misma semántica que corre en producción.
 *
 * ── Criterio para agregar algo acá ──────────────────────────────────────────
 *
 * Solo assets estáticos sin ningún dato de negocio, o pantallas que tienen que
 * funcionar SIN sesión por diseño. Ante la duda, no se agrega: abrir una ruta sin
 * autenticación es peor que la molestia de un asset que pide login.
 */

/**
 * Coincidencia EXACTA de path completo. Nada de prefijos: `/offline` es público,
 * `/offline-config` no lo es.
 */
const RUTAS_EXACTAS = new Set([
  // Service worker. Si requiere sesión, el navegador recibe un redirect al
  // registrarlo y el SW nunca se instala — la PWA queda inerte sin ningún
  // síntoma visible.
  "/sw.js",
  // Sin manifest ni icono accesibles no hay prompt de instalación.
  "/manifest.webmanifest",
  "/icon.svg",
  // Pantalla de fallback sin conexión. Protegerla es un círculo vicioso: el
  // middleware querría redirigir al login y NO HAY RED para resolver ese
  // redirect, así que el operario vería el error genérico del navegador en vez
  // del mensaje que le explica que sus muestras no se perdieron. Es texto
  // estático, sin datos.
  "/offline",
]);

/**
 * Workers auxiliares que genera serwist con el hash del build en el nombre.
 * `[^/]*` y anclado a los dos extremos: matchea el archivo y nunca un subpath.
 */
const PATRON_WORKER_SERWIST = /^\/swe-worker-[^/]*\.js$/;

export function esRutaPublica(pathname: string): boolean {
  return RUTAS_EXACTAS.has(pathname) || PATRON_WORKER_SERWIST.test(pathname);
}
