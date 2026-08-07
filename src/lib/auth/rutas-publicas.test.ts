/**
 * Guardarraíl sobre qué se sirve SIN sesión.
 *
 * Testea la función que corre en producción, no una réplica del `matcher`: el
 * intento anterior evaluaba el string del matcher como regex de JS y pasaba en
 * verde mientras path-to-regexp hacía otra cosa en producción (ver el comentario
 * de rutas-publicas.ts). Un test con falsa confianza es peor que no tener test.
 *
 * Se verifican las dos direcciones, y la segunda importa igual o más: que los
 * assets de la PWA sean públicos, y que NADA más lo sea.
 */

import { describe, it, expect } from "vitest";
import { esRutaPublica } from "./rutas-publicas";

describe("esRutaPublica", () => {
  it.each([
    "/sw.js",
    "/manifest.webmanifest",
    "/icon.svg",
    "/offline",
    "/swe-worker-development.js",
    "/swe-worker-5c72df51bb1f6ee8.js",
  ])("%s es público", (ruta) => {
    expect(esRutaPublica(ruta)).toBe(true);
  });

  it.each([
    "/",
    "/calidad",
    "/calidad/puntos-control",
    "/calidad/lotes/nuevo",
    "/calidad/abc-123/def-456",
    "/maestro",
    "/api/v1/calidad/registros",
  ])("%s NO es público", (ruta) => {
    expect(esRutaPublica(ruta)).toBe(false);
  });

  it("coincide por path EXACTO, no por prefijo", () => {
    // Es el bug concreto que tenía la versión basada en el matcher: excluir
    // `offline` también dejaba sin autenticación cualquier `/offline-*`.
    expect(esRutaPublica("/offline")).toBe(true);
    expect(esRutaPublica("/offline-config")).toBe(false);
    expect(esRutaPublica("/offline/detalle")).toBe(false);
  });

  it("no se puede colar un subpath detrás del nombre de un asset", () => {
    expect(esRutaPublica("/sw.js/algo")).toBe(false);
    expect(esRutaPublica("/icon.svg/../secreto")).toBe(false);
    expect(esRutaPublica("/swe-worker-abc.js/x")).toBe(false);
  });

  it("no matchea el nombre de un asset en otra posición del path", () => {
    expect(esRutaPublica("/calidad/sw.js")).toBe(false);
    expect(esRutaPublica("/maestro/icon.svg")).toBe(false);
  });

  it("el patrón del worker de serwist exige el prefijo y la extensión", () => {
    expect(esRutaPublica("/swe-worker-.js")).toBe(true);
    expect(esRutaPublica("/swe-worker-abc.txt")).toBe(false);
    expect(esRutaPublica("/otro-worker-abc.js")).toBe(false);
  });
});
