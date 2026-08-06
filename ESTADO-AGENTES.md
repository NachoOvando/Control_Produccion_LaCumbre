# Estado de agentes — cadena de aprobación

> Se actualiza SOLO cuando hay un veto, un hallazgo crítico, o una decisión
> estructural pendiente de cierre. Si una cadena de agentes para un feature
> se completó sin problemas de punta a punta, NO queda rastro acá — para eso
> ya está el commit de git. Este archivo es para lo que quedó "colgado" entre
> sesiones, no un log general.

## Cadena abierta actualmente
**Feature/tarea:** Lote 0 — cerrar el veto de `seguridad-analista` sobre
`AUDITORIA_FLUJOS_DATOS.md` (C1, C2, C3).
**Último agente invocado:** `seguridad-analista` (re-validación, 2026-07-27).
**Veredicto de ese agente:** **Veto parcial — se levanta C3, siguen abiertos C1 y C2.**
Ver detalle abajo.

**ACTUALIZACIÓN 2026-07-29 — riesgo aceptado explícitamente por el usuario, cadena
ya NO bloquea trabajo nuevo:** se le preguntó directamente si, dado que no iba a
rotar las contraseñas (C1) ni había confirmado el secreto en Vercel (C2), quería
seguir bloqueado o aceptar el riesgo y avanzar con features nuevas. **Respuesta
explícita: acepta el riesgo, seguir con trabajo nuevo.** A partir de esta decisión:
- **No preguntar esto de nuevo** en sesiones futuras salvo que cambien las
  circunstancias (ej. el usuario menciona que sí va a rotar, o aparece un hallazgo
  nuevo no cubierto por este veto).
- C1/C2 siguen técnicamente "abiertos" en el registro de abajo — es intencional,
  documenta el riesgo real que sigue existiendo en la Supabase de producción, no
  una tarea pendiente de retomar por iniciativa propia.
- Si en algún momento el usuario decide rotar las 6 contraseñas y confirmar
  `AUTH_SECRET` en Vercel, corresponde volver a invocar `seguridad-analista` para
  el cierre formal (paso 3 más abajo) — recién ahí se borra esta sección.

**Re-validación de `seguridad-analista` (2026-07-27), verificada con herramientas
propias, no solo confiando en el resumen de la sesión anterior:**

- **C3 — CERRADO.** `npm audit` real: `{"critical":0,"moderate":0,"high":12,"total":12}`.
  `@auth/core` en `0.41.3` (era `<=0.41.2`), `next-auth` en `5.0.0-beta.32`. Los 12
  `high` restantes son los ya conocidos y aceptados en la auditoría original (`next`→16
  breaking, `postcss` atado a esa migración, `xlsx` sin fix, `brace-expansion`→eslint
  breaking) — ninguno nuevo. `npx tsc --noEmit` limpio. `npm run test`: 110/110 tests
  pasando. Confirmado, no hay nada más que hacer acá.

- **C1 — VETO PARCIAL, sigue abierto.** El código está corregido y verificado:
  `prisma/seed.ts:648-655` lee `SEED_USER_PASSWORD` del entorno, `throw` explícito si
  falta, un solo `bcrypt.hash` en todo el archivo (las 6 cuentas comparten la misma
  passphrase de entorno, ninguna hardcodeada). `.env.example` documenta la variable.
  **Pero el riesgo de negocio de C1 no es "el seed puede volver a inventar una
  contraseña" — es que las 6 cuentas que HOY existen en la Supabase real, dos `admin`
  incluidas, siguen autenticando con `bcrypt.compare` contra las contraseñas literales
  del repo** (verificado en la auditoría original contra los hashes reales de
  producción). El fix de código no toca esos hashes ya persistidos. Mientras no se
  rueden, cualquiera con acceso al repo (histórico de git incluido — el literal estuvo
  en claro en commits pasados) sigue entrando como `admin`. **El veto sobre C1 sigue
  vigente hasta que se confirme la rotación real.**

- **C2 — VETO ABIERTO, sin cambios de hecho.** Verificado en `.env.local`: el
  `AUTH_SECRET` vigente sigue siendo el de 33 caracteres, charset de 15 símbolos
  únicos (bajo para 256 bits reales) — el secreto nuevo generado con
  `openssl rand -base64 32` **todavía no se pegó**. Mientras `AUTH_SECRET` sea el
  mismo de baja entropía, cualquier JWT de sesión sigue siendo falsificable offline
  con fuerza bruta de diccionario, y **esto neutraliza también el fix de C1**: aunque
  se rotaran las 6 contraseñas hoy mismo, quien tenga el secreto de firma no necesita
  ninguna contraseña — forja el JWT directo con `rol: "admin"`. **El veto sobre C2 no
  se levanta con "el secreto ya se generó", se levanta cuando esté aplicado en
  `.env.local` Y en Vercel (Production + Preview), y las sesiones viejas hayan
  quedado invalidadas por el cambio de secreto.**

**Qué falta EXACTAMENTE para cerrar el veto (acciones que el usuario ejecuta él
mismo, no son de código):**
1. **C1:** entrar a Supabase (tabla `usuarios` o vía Studio/panel de auth) y rotar
   las 6 contraseñas reales — las 2 cuentas `admin` primero — a valores que no sean
   los literales `password123` / `lacumbre` ni derivados de ellos. Hacerlo en la
   misma ventana que el punto 2 (rotar `AUTH_SECRET` invalida todas las sesiones
   vivas — es el momento de aprovechar y forzar relogin con la contraseña nueva).
2. **C2:** pegar el `AUTH_SECRET` nuevo (generado con `openssl rand -base64 32`,
   ya entregado en el chat de la sesión anterior) en `.env.local` para desarrollo
   local, y en Vercel → Settings → Environment Variables, para **Production y
   Preview** (no solo uno de los dos entornos). Redeploy después de guardarlo en
   Vercel para que tome efecto — Vercel no reinyecta env vars sobre un deploy ya
   corriendo.
3. Volver a invocar `seguridad-analista` después de 1 y 2, para confirmar contra la
   DB real (igual que la verificación original) que las 6 cuentas ya no entran con
   las contraseñas viejas, y que el JWT emitido usa el secreto nuevo. Recién ahí se
   levanta el veto completo y se puede retomar el pedido original del usuario
   (fixes de auditoría + feature flags + deploy progresivo).

**Corresponde invocar a continuación:** nadie todavía — queda en manos del usuario
ejecutar 1 y 2 de arriba. Cuando confirme que lo hizo, volver a invocar
`seguridad-analista` para el cierre final de C1/C2 (paso 3).
**Contexto a pasar la próxima vez:** este bloque completo + `AUDITORIA_FLUJOS_DATOS.md`
§4.

## Vetos / hallazgos críticos sin resolver
<!-- Principalmente seguridad-analista. Mientras haya algo acá, ninguna
tarea relacionada se da por cerrada, sin excepción. -->
- **C1 — Contraseñas del seed vigentes en la Supabase real, dos cuentas `admin`
  incluidas. VETO PARCIAL: código corregido (`prisma/seed.ts:648-655`,
  verificado por grep en esta sesión), pendiente 100% del usuario la rotación real
  de las 6 contraseñas en la DB de producción.** Sin esa rotación, las cuentas
  actuales —incluidas las 2 `admin`— siguen aceptando la contraseña literal que
  estuvo (y sigue) en el historial de git.
- **C2 — `AUTH_SECRET` sigue siendo la passphrase de baja entropía original.
  VETO SIN CAMBIOS DE HECHO: se generó un secreto nuevo con `openssl rand -base64 32`
  pero no se aplicó** — verificado en esta sesión que `.env.local` sigue con el valor
  viejo (33 chars, 15 símbolos únicos). Falta pegarlo en `.env.local` y en Vercel
  (Production + Preview) y redeployar.
- ~~C3 — Vulnerabilidades críticas sin parchear en `@auth/core`/`next-auth`.~~
  **CERRADO (2026-07-27):** `npm audit` confirma 0 críticos/0 moderados,
  `@auth/core@0.41.3`, `next-auth@5.0.0-beta.32`, 110/110 tests, typecheck limpio.

## Decisiones estructurales pendientes de confirmación del usuario
<!-- arquitecto-industrial (u otro agente) devolvió algo que requiere tu OK
explícito antes de que se siga construyendo sobre esa base -->
-

## Historial de cadenas cerradas
<!-- Opcional. Una línea por cadena resuelta, solo si te sirve tener traza
rápida sin ir a buscar en git log. Si no lo usás, borrá esta sección. -->
- 2026-07-27 — C3 de la auditoría de flujos de datos (vulnerabilidades críticas en
  `@auth/core`/`next-auth`) cerrado por `seguridad-analista` tras verificar
  `npm audit` real, versiones bumpeadas y suite de tests completa.
