/// <reference lib="webworker" />

/**
 * Service worker de la app de Calidad.
 *
 * ALCANCE DELIBERADAMENTE MÍNIMO. Este SW cubre UN solo escenario: la tablet se
 * reinició o el navegador se cerró, y al volver a abrir la app no hay red. Sin
 * él, el navegador muestra su propia pantalla de "sin conexión" y el operario no
 * puede ni entrar.
 *
 * El escenario DOMINANTE en planta —la app está abierta y el WiFi se cae— NO lo
 * resuelve el SW: lo resuelve la cola en IndexedDB (lib/offline/cola.ts), que
 * corre en el hilo principal. Por eso este lote fue el último del plan y no el
 * primero: es el de menor relación valor/riesgo.
 *
 * ── El SW NO contiene lógica de negocio ──────────────────────────────────────
 *
 * Nada de cola de sincronización acá. Un bug de sincronización dentro del SW es
 * indepurable en una tablet de planta: no hay devtools útiles, el contexto vive
 * aparte del de la página, y el ciclo de vida del SW (instalación, activación,
 * versiones viejas sirviendo pedidos) agrega modos de falla que nadie va a poder
 * diagnosticar a las 3 de la mañana en el turno noche.
 *
 * Tampoco se usa Background Sync: no da feedback de UI (el operario no sabría si
 * subió) y no existe en iOS. Los dispositivos de planta son Android (D7), pero la
 * decisión se mantiene por portabilidad.
 *
 * ── Regla de seguridad, no negociable ────────────────────────────────────────
 *
 * El SW NUNCA cachea respuestas de `/api/` ni de rutas autenticadas. Las tablets
 * de planta son COMPARTIDAS entre operarios y entre turnos: un SW que cachee una
 * respuesta autenticada o la página de login convierte el caché en una fuga de
 * datos entre operarios, y encima invisible. Solo se precachea el shell estático
 * que Next genera con hash en el nombre.
 */

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Guardarraíl explícito de la regla de seguridad: cualquier pedido a `/api/`, al
 * login o a las rutas de auth va SIEMPRE a la red y nunca al caché, sin importar
 * qué traiga `defaultCache` en la próxima versión menor de la librería.
 *
 * EL ORDEN IMPORTA Y NO ES COSMÉTICO: este listener se registra ANTES de
 * `serwist.addEventListeners()`. Los listeners de `fetch` se disparan en orden de
 * registro, y `respondWith` solo puede llamarse una vez por evento — si Serwist
 * respondiera primero, esta llamada tiraría `InvalidStateError` y el guardarraíl
 * quedaría muerto sin que nada lo avise. No mover esto abajo.
 */
self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  const esApiOAuth =
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/login") ||
    url.pathname.includes("/auth/");

  if (esApiOAuth) {
    // Responder acá corta el paso al resto de los handlers, incluidos los de
    // Serwist: el pedido nunca entra al pipeline de caché.
    event.respondWith(fetch(event.request));
  }
});

const serwist = new Serwist({
  // Manifest de precache generado por serwist contra los assets hasheados del
  // build. Es la razón de usar serwist en vez de un SW a mano: mantener a mano
  // la lista de assets con hash se rompe en cada build.
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,

  runtimeCaching: [
    // `defaultCache` de @serwist/next cubre los assets estáticos de Next
    // (chunks JS, CSS, fuentes, imágenes) con estrategias razonables.
    //
    // IMPORTANTE: `defaultCache` incluye una entrada para las rutas de API de
    // Next con NetworkOnly, que es lo que se quiere. Se filtra igual de forma
    // explícita más abajo, para que la garantía no dependa de qué traiga la
    // librería en la próxima versión menor.
    ...defaultCache,
  ],

  fallbacks: {
    entries: [
      {
        // Página servida cuando el operario navega sin red y el destino no está
        // en el precache.
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
