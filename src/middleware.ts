import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Middleware usa solo authConfig (Edge-safe, sin Prisma ni pg).
// La protección de rutas API se hace a nivel de route handler con auth() de auth.ts.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
