import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { authConfig } from "./auth.config";
import {
  loginBloqueado,
  registrarFalloLogin,
  limpiarFallosDeEmail,
} from "./auth/rate-limit-login";

// Guard de boot: DEMO_MODE en producción sería una segunda contraseña admin
// activa (el login demo resuelve al usuario real, ver ADR-007). Falla el
// arranque, no un warning — este archivo se importa en el primer request
// autenticado, antes de que cualquier login demo pueda ocurrir.
if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE === "true") {
  throw new Error(
    "DEMO_MODE=true no está permitido en producción — remover la variable del entorno antes de desplegar"
  );
}

// Hash dummy para igualar el tiempo de respuesta cuando el email no existe:
// sin esto, un usuario inexistente respondía ~100-200ms más rápido que una
// password incorrecta (se salteaba bcrypt.compare) y permitía enumerar
// emails válidos por timing — auditoría 2026-07, deuda #11. Coste 12: DEBE
// coincidir con el de los hashes reales (prisma/seed.ts usa bcrypt.hash(..., 12)),
// si no la diferencia de coste reabre el canal de timing.
const DUMMY_HASH = bcrypt.hashSync("igualador-de-timing-sin-valor-secreto", 12);

// IP del cliente, SOLO como señal de detección en logs — nunca como clave de
// bloqueo: sin un reverse proxy delante, x-forwarded-for llega tal cual lo
// mande el cliente (spoofeable, verificado con curl), así que un valor acá
// puede ser mentira deliberada. Ver rate-limit-login.ts.
function ipDelRequest(request: Request | undefined): string {
  const forwarded = request?.headers?.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request?.headers?.get("x-real-ip") ?? "desconocida";
}

// Registra el fallo y loguea SOLO las transiciones de umbral (una línea por
// bloqueo/sospecha, no por intento) — nunca la password.
function registrarFalloConLog(email: string, ip: string) {
  const { emailBloqueado, ipSospechosa } = registrarFalloLogin(email, ip);
  if (emailBloqueado) {
    console.warn("[AUTH] Email bloqueado 15 min tras 5 fallos de login", { email, ip });
  }
  if (ipSospechosa) {
    console.warn(
      "[AUTH] Actividad sospechosa: 30+ fallos de login en 15 min desde la misma IP (solo detección, no bloquea)",
      { ip }
    );
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        // Normalización única del email: la misma forma alimenta el rate
        // limiting y el lookup — si se normalizara en un solo lado,
        // "Admin@x.com" evadiría el límite de "admin@x.com".
        const email = (credentials.email as string).trim().toLowerCase();
        const ip = ipDelRequest(request);
        // El rechazo por bloqueo es silencioso a nivel log: la transición a
        // bloqueado ya se logueó una vez (con email+ip del causante) en
        // registrarFalloLogin — loguear cada intento posterior convertiría
        // el log de detección en floodeable.
        if (loginBloqueado(email)) return null;

        // Usuario demo para desarrollo sin DB.
        // Solo existe si DEMO_MODE=true, NUNCA en producción, y la contraseña
        // viene de una variable de entorno — jamás literal en código.
        if (
          process.env.NODE_ENV !== "production" &&
          process.env.DEMO_MODE === "true" &&
          process.env.DEMO_USER_EMAIL &&
          process.env.DEMO_USER_PASSWORD &&
          credentials.email === process.env.DEMO_USER_EMAIL &&
          credentials.password === process.env.DEMO_USER_PASSWORD
        ) {
          // Con DB disponible, resolver el usuario REAL por email (solo el email
          // fijo de DEMO_USER_EMAIL — la contraseña demo no sirve para impersonar
          // a otros usuarios). El UUID fantasma de abajo no existe en `usuarios`:
          // una sesión con ese id rompe con P2003 toda escritura con FK a usuarios
          // (activadoPorId, creadoPorId, responsableId).
          console.warn("[AUTH] Sesión iniciada por MODO DEMO — apagar DEMO_MODE cuando el login real esté operativo");
          try {
            const usuarioReal = await prisma.usuario.findUnique({
              where: { email: process.env.DEMO_USER_EMAIL },
              select: { id: true, email: true, nombre: true, rol: true, activo: true },
            });
            // DB respondió: el usuario real manda, incluso si eso significa
            // rechazar el login (inactivo o no existe) — el fantasma NO es un
            // segundo plan para sortear una desactivación real.
            if (usuarioReal) {
              if (!usuarioReal.activo) return null;
              return {
                id: usuarioReal.id,
                email: usuarioReal.email,
                name: usuarioReal.nombre,
                rol: usuarioReal.rol,
              };
            }
          } catch {
            // DB inalcanzable — único caso donde cae al fantasma (modo demo sin DB, solo lectura)
            return {
              id: "00000000-0000-0000-0000-000000000001",
              email: process.env.DEMO_USER_EMAIL,
              name: "Usuario Demo",
              rol: "admin",
            };
          }
          return null;
        }

        try {
          const usuario = await prisma.usuario.findUnique({
            where: { email },
            select: {
              id: true,
              email: true,
              nombre: true,
              rol: true,
              activo: true,
              password: true,
            },
          });

          if (!usuario || !usuario.activo) {
            // Pagar el mismo bcrypt que el camino de password incorrecta —
            // ver comentario de DUMMY_HASH.
            await bcrypt.compare(credentials.password as string, DUMMY_HASH);
            registrarFalloConLog(email, ip);
            return null;
          }

          const passwordValido = await bcrypt.compare(
            credentials.password as string,
            usuario.password
          );

          if (!passwordValido) {
            registrarFalloConLog(email, ip);
            return null;
          }

          limpiarFallosDeEmail(email);
          return {
            id: usuario.id,
            email: usuario.email,
            name: usuario.nombre,
            rol: usuario.rol,
          };
        } catch {
          // Error de DB: no cuenta como intento fallido (no es un password malo)
          return null;
        }
      },
    }),
  ],
});
