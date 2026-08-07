import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA. Se declara como `app/manifest.ts` y no como
 * `public/manifest.json` para que sea tipado y quede versionado con el resto de
 * la app — Next lo sirve en `/manifest.webmanifest`.
 *
 * Para qué se instala la app en la tablet: para que abra sin barra de navegador
 * (menos superficie para que un operario navegue a otra cosa con guantes) y para
 * que el service worker tenga un scope estable. No agrega ninguna capacidad de
 * captura por sí solo — eso lo da la cola de IndexedDB.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "La Cumbre — Control de Producción",
    short_name: "LC Calidad",
    description:
      "Registro de controles de calidad en planta. Funciona sin conexión: las muestras se guardan en el dispositivo y se suben al volver la red.",
    // `start_url` apunta al módulo de Calidad y no a la raíz: es lo único que el
    // operario usa, y evitarle un click en cada apertura del turno no es un
    // detalle cuando son decenas de aperturas por día.
    start_url: "/calidad",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#E1000F",
    lang: "es-AR",
    dir: "ltr",
    icons: [
      {
        src: "/icon.svg",
        // `any` en vez de un tamaño fijo: es vectorial, sirve para toda densidad.
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        // Android recorta el icono según el launcher (círculo, squircle). El SVG
        // mantiene el texto dentro del 80% central para sobrevivir el recorte.
        purpose: "maskable",
      },
    ],
  };
}
