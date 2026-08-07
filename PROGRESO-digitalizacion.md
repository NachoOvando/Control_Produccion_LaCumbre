# Progreso — Proyecto Digitalización La Cumbre

> Con git local activo, el "qué se hizo" ya vive en `git log` — no lo
> dupliques acá. Este archivo es para lo que git NO captura: en qué estás
> pensando ahora, cuál es el próximo paso concreto, y qué está bloqueado.
> Actualizalo al cerrar cada sesión, antes de cortar.

**Última actualización:** 07/08/2026

## Enfoque actual

Ejecutando el plan de `~/.claude/plans/continuemos-trabajando-wiggly-wreath.md`,
lote por lote, en `Dev`. **Lote 0 y Lote 1 cerrados y pusheados** (`e1832a0`,
`f003307`).

Arrancó de dos pedidos: eliminar la carga de datos repetidos del maestro, y
resolver qué pasa cuando se pierde internet en planta. El relevamiento mostró que
ninguno de los dos era el problema que parecía — el detalle completo está en
`docs/LOG_CONTEXTO.md`, hito 2026-08-07. En corto, lo que se cerró:

- **La duplicación silenciosa de registros HACCP** por reintento tras corte de red,
  que era el único hallazgo de integridad activo en producción. Deuda escalada en
  ADR-017 y sin resolver hasta ahora. Verificado end-to-end contra la DB real,
  con contraprueba de que sin la clave el duplicado sí ocurría.
- **Dos bindings de especificación rotos** (`peso_bano` y `peso_neto`), ninguno con
  specs cargadas todavía, más el guardarraíl que debía atraparlos y no podía.
- **La política de dos capas** en la visibilidad de especificación (tu decisión D5).

### Lo que sigue, en orden

**Lote A — unificación gravimétrica.** Desbloqueado: ya están las 4 definiciones
metrológicas (D1-D4 en `docs/LOG_CONTEXTO.md`). Es el que responde al pedido
original: hoy Control Peso Relleno **persiste una resta que el operario hace de
cabeza**, y el dato primario no queda en ningún lado — ante un reclamo de Arcor no
se puede distinguir si el desvío vino de la dosificación de DDL o de tapas fuera de
gramaje.

**Lote 2 — cola offline** (IndexedDB + `idb`, capas puertos/adaptadores en
`lib/offline/`). Incluye el endpoint `captura-bootstrap`, que se movió del Lote 1
porque hoy sería un endpoint sin consumidor.

**Lote 3 — PWA** (`@serwist/next`). Último a propósito: el escenario dominante en
planta es "la app está abierta y se cae el WiFi", y eso lo cubre el Lote 2 sin
service worker.

**Lote 4 — PCC con pantalla de bloqueo.** **Bloqueado** por la lista real de PCC del
plan HACCP.

---

### Sesión anterior (29/07/2026)

Cerrado: auditoría integral de flujos CRUD
(`AUDITORIA_FLUJOS_DATOS.md`, agentes `audit-planner`/`fix-executor` nuevos
en `.claude/agents/`), fix del pipeline de build de Vercel (Prisma Client
nunca se generaba — `"build": "prisma generate && next build"`), y **flujo
de ramas nuevo: `Dev` para desarrollo, `main` solo por merge commit
explícito cuando algo es definitivo** (documentado en `CLAUDE.md`). Trabajo
actual parado en `Dev`, un commit adelante de `main`.

**Limpieza total de datos de prueba (2026-07-29):** se borró el 100% de
`lotes`, `registros_calidad`, `auditoria_registros`,
`linea_produccion_estado`, `linea_activacion_log` y `secuencias_diarias` en
la Supabase real — todo era de desarrollo, sin ningún dato de operación
real todavía. El maestro (`productos`, `usuarios`, etc.) no se tocó. **Esto
invalida cualquier pendiente de sesiones anteriores que dependiera de datos
ya cargados** (ver nota en "Notas sueltas").

**Decisión de riesgo aceptada explícitamente por el usuario, no un
olvido:** el veto de `seguridad-analista` sobre C1/C2 de
`AUDITORIA_FLUJOS_DATOS.md` sigue formalmente abierto — el usuario decidió
NO rotar las 6 contraseñas reales de Supabase (2 `admin` incluidas) y
aceptó el riesgo conscientemente para poder seguir trabajando en features.
**No volver a bloquear trabajo nuevo por C1/C2 sin que haya un motivo
nuevo** — ver `ESTADO-AGENTES.md` para el detalle completo y no repetir la
pregunta si el usuario ya la respondió.

## Próximo paso

0. **Ninguno de los pendientes de TAPAS/Control Peso Tapas de sesiones
   anteriores tiene datos reales para verificar hoy** — la limpieza del
   2026-07-29 borró todos los lotes/registros de prueba. Si se retoma esa
   línea de trabajo, hay que volver a activar producto y cargar de cero.
1. **Rotar las 6 contraseñas reales en Supabase + confirmar `AUTH_SECRET`
   en Vercel** sigue siendo lo único que cerraría el veto C1/C2 del todo —
   pendiente 100% del usuario, no bloqueante por decisión propia (ver
   arriba). `AUTH_SECRET` nuevo ya está en `.env.local`; falta confirmar
   Vercel (Production + Preview) + redeploy.
2. **Cargar `Producto.vidaUtilMeses` de TAPAS** desde `/calidad/maestro` —
   sigue bloqueando la activación de TAPAS en Línea 3 con `409
   PRODUCTO_SIN_VIDA_UTIL` (ADR-013). Deuda de dato maestro, no de código.
3. **Definir la lista real de PCC del plan HACCP** — pendiente de sesiones
   anteriores, sigue abierto.
4. **Lote 1-10 de `AUDITORIA_FLUJOS_DATOS.md` §8** — solo se ejecutaron los
   3 puntos críticos (C1 código, C2 secreto generado, C3 cerrado). El resto
   de los hallazgos (A1-A4, M1-M10, B1-B14) sigue sin tocar. Empezar por
   Lote 1 (A1 — segregación de entornos: dev apunta a la DB de producción
   con `DEMO_MODE`) tiene sentido antes de sumar más features, dado que es
   la causa raíz de por qué toda la data de prueba terminó en la DB real.
5. **Pedido original que motivó todo esto** (fixes de auditoría + feature
   flags + deploy progresivo) sigue sin diseñarse — recién ahora que existe
   `Dev` tiene sentido retomarlo ahí.
6. Pendientes de arrastre de sesiones previas, sin cambios: `EspecificacionProducto`
   reales de TAPAS (peso_tapa, peso_cobertura, temp_ambiente, temp_bano —
   catálogo/bindings ya sembrados); `REVOKE UPDATE/DELETE` sobre tablas
   append-only antes de Arcor (M6 de la auditoría, mismo tema que el
   pendiente #5 viejo); RBAC por rol/línea.

## Bloqueadores

Ninguno duro. C1/C2 quedan como riesgo aceptado (ver arriba), no como
bloqueador de trabajo nuevo.

## Notas sueltas

- **Toda referencia a datos de prueba específicos (IDs de lote, registros,
  activaciones) de `LOG_CONTEXTO.md` anterior al 2026-07-29 ya no existe en
  la DB** — son historia de cómo se llegó hasta acá, no datos para
  verificar contra la base real hoy.
- `softDeleteRegistro` (`src/db/calidad.repository.ts`) sigue completo y
  sin ningún endpoint que lo use — si se pide una función permanente de
  borrado/marcado de registros, es la pieza más barata de cablear.
- Repo tiene dos ramas: `main` (definitivo) y `Dev` (desarrollo activo,
  checkout actual). `gh` CLI no está instalado — el merge `Dev` → `main`
  es local (`git merge`), sin Pull Requests.
