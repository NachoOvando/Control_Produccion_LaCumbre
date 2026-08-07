import type { NextAuthConfig } from "next-auth";
import { esRutaPublica } from "@/lib/auth/rutas-publicas";

// Edge-safe config — sin imports de Node.js (sin Prisma, sin bcrypt).
// Usado por middleware.ts para proteger rutas en el Edge runtime.
// La lógica de authorize (que necesita Prisma) vive en auth.ts.
export const authConfig: NextAuthConfig = {
  providers: [],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      // Assets de la PWA y pantalla de fallback sin conexión: se sirven sin
      // sesión. Va PRIMERO, antes de cualquier chequeo de login, porque el
      // service worker y la pantalla de offline tienen que responder incluso
      // cuando no hay sesión válida ni red para renovarla. Ver el comentario
      // largo de rutas-publicas.ts: esto no se puede resolver en el `matcher`.
      if (esRutaPublica(nextUrl.pathname)) return true;

      const isLoggedIn = !!auth?.user;
      const isLoginPage = nextUrl.pathname.startsWith("/login");

      if (isLoginPage) {
        // Si ya está autenticado, redirigir al home
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }

      if (!isLoggedIn) {
        const callbackUrl = nextUrl.pathname + nextUrl.search;
        return Response.redirect(
          new URL(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, nextUrl)
        );
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.rol = (user as { rol: string }).rol;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.rol = token.rol as string;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
};
