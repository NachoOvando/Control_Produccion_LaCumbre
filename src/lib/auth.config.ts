import type { NextAuthConfig } from "next-auth";

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
