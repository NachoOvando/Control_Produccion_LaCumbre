import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";

/**
 * Revalidación periódica del JWT contra la DB.
 *
 * Los JWT de NextAuth viven 30 días y, sin esto, nada vuelve a mirar la DB
 * después del login: un token cuyo usuario ya no existe (el "usuario fantasma"
 * del viejo modo demo — incidente 2026-07-16, P2003 en toda escritura) o fue
 * desactivado sigue siendo una sesión válida hasta que expira. Este helper se
 * llama desde el callback `jwt` de la instancia Node (auth.ts) — NUNCA desde
 * auth.config.ts, que debe seguir Edge-safe sin Prisma.
 */

// Revalidar como máximo una vez por minuto por sesión: costo ~cero (un lookup
// por PK indexada) y acota a 1 min la ventana en la que una desactivación
// todavía no se refleja en la sesión.
const INTERVALO_REVALIDACION_MS = 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function validarTokenSesion(token: JWT, ahora: number): Promise<JWT | null> {
  // Un token sin id usable no es rescatable — matarlo sin tocar la DB
  // (también evita que un id malformado dispare P2023 y caiga en el fail-open).
  if (typeof token.id !== "string" || !UUID_RE.test(token.id)) return null;

  if (typeof token.validadoEn === "number" && ahora - token.validadoEn < INTERVALO_REVALIDACION_MS) {
    return token;
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: token.id },
      select: { activo: true, rol: true },
    });
    if (!usuario || !usuario.activo) return null;
    // rol refrescado: un cambio de rol en DB se propaga a la sesión viva
    // en ≤1 min en vez de arrastrar el rol del momento del login por 30 días.
    return { ...token, rol: usuario.rol, validadoEn: ahora };
  } catch {
    // DB inalcanzable: fail-open (devolver el token tal cual). Un blip de red
    // en planta no debe desloguear a todos los operarios a la vez; las
    // escrituras siguen protegidas por las FK a usuarios aunque la sesión viva.
    return token;
  }
}
