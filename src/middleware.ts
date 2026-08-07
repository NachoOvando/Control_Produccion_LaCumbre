import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Middleware usa solo authConfig (Edge-safe, sin Prisma ni pg).
// La protección de rutas API se hace a nivel de route handler con auth() de auth.ts.
export default NextAuth(authConfig).auth;

// El matcher se deja simple a propósito: solo excluye assets internos de Next y
// las API routes (que se protegen en cada handler). Los assets de la PWA y la
// pantalla /offline NO se excluyen acá — se permiten en el callback `authorized`
// con comparación exacta de path.
//
// El motivo está documentado en lib/auth/rutas-publicas.ts, y vale releerlo antes
// de tocar este string: el `matcher` NO es un regex de JS, lo procesa
// path-to-regexp, y anclar las exclusiones con `$` hizo que capturara TODO sin
// emitir ninguna advertencia. Todo pasó a redirigir al login.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
