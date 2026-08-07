import withSerwistInit from "@serwist/next";

/**
 * PWA con serwist (ver src/app/sw.ts para el alcance y las reglas del SW).
 *
 * Se eligió serwist y no `next-pwa`: `next-pwa` está efectivamente sin
 * mantenimiento y su soporte de App Router es de segunda mano. serwist es el
 * sucesor de Workbox con soporte de primera para App Router, y genera el manifest
 * de precache contra los assets hasheados de cada build — mantener esa lista a
 * mano se rompe en cada deploy.
 *
 * `disable` en desarrollo: un service worker activo en `next dev` sirve versiones
 * cacheadas del shell y hace que los cambios no se vean, lo que se diagnostica
 * mal y cuesta horas. El SW se prueba con `npm run build && npm start`.
 */
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // El SW se registra solo al cargar la app.
  register: true,
  reloadOnOnline: false,
});

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withSerwist(nextConfig);
