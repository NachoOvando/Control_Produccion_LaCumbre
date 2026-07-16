# LOG DE CONTEXTO — Control de Producción La Cumbre

> Este archivo actúa como memoria estructurada del proyecto.
> Antes de proponer cambios arquitectónicos o de lógica de negocio, **leer este archivo completo**.
> Cada hito documenta decisiones que NO deben revertirse sin razón explícita.

---

### [2026-07-16] - Cierre de deuda de auditoría: rate limiting de login (#10, #11) + retención de backups (#12 parcial)

- **Contexto:** 3 hallazgos de `seguridad-analista` de la auditoría de julio, marcados "importantes, no urgentes", cerrados a pedido del usuario.
- **Cambios:** nuevo módulo puro `src/lib/auth/rate-limit-login.ts` (rate limiting extraído de `auth.ts`, testeable sin NextAuth) con dos contadores en memoria — bloqueo duro por email (5 fallos/15min, preexistente) y detección por IP (30 fallos/15min, **nunca bloquea**, solo logea "actividad sospechosa"). `auth.ts` ganó: hash dummy bcrypt (coste 12) para igualar timing en usuario inexistente/inactivo, extracción de IP para logging, normalización de email (trim+lowercase) antes de rate limiting y lookup. 7 tests nuevos en `rate-limit-login.test.ts` (suite total: 35 tests, 6 archivos). `scripts/backup-db.ps1` agrega retención (conserva los 10 backups más recientes).
- **Iteración de seguridad importante para no repetir:** la primera versión implementaba bloqueo real por IP (no solo detección). `seguridad-analista` encontró un hallazgo Alto: en esta topología sin reverse proxy, `x-forwarded-for` es spoofeable por curl (verificado empíricamente con un request real) y los navegadores sin ese header comparten el bucket "desconocida" — un atacante podía tumbar el login de TODA la planta con 30 requests sin headers, algo que no era posible antes de este cambio. Se corrigió bajando el límite por IP a "solo detección, nunca bloqueo" — lección: cualquier rate limiting por IP en este proyecto, mientras no haya un proxy confiable delante, no puede usarse como clave de bloqueo, solo de logging.
- **Verificado en browser contra el dev server real:** 5 fallos → 6to y 7mo rechazados en ~40-56ms (antes de tocar DB) sin líneas de log repetidas; timing de usuario inexistente vs password mala equivalente; normalización de email confirmada (mayúsculas+espacio contaron igual); login legítimo intacto; retención de backups probada con 13 archivos dummy → quedaron 10.
- **Aprobado por `seguridad-analista`** en dos pasadas (veto del hallazgo Alto en la primera, aprobado sin observaciones bloqueantes en la segunda tras el fix).

---

### [2026-07-15] - Fixes de auditoría + infraestructura de testing (Vitest)

- **Guard de boot** (`src/lib/auth.ts`, top-level): `NODE_ENV=production` + `DEMO_MODE=true` → el servidor no arranca. Cierra la deuda #2 de la auditoría (el login demo resuelve a un admin real, no puede existir en prod).
- **Rate limiting de login** (`authorize()`): 5 intentos fallidos por email en 15 min → bloqueo (en memoria de proceso, per-instancia — si se escala horizontal, migrar a guard basado en DB como el de producto-activo). Login exitoso resetea; error de DB no cuenta como fallo. **Verificado en browser**: 5 fallos reales → el 6to intento con la password correcta fue rechazado; otro email entró normal. Deuda #3 resuelta.
- **Validación producto↔línea server-side** (`linea-producto-activo.service.ts`): producto con `lineaProductivaId` de otra línea → `409 PRODUCTO_LINEA_INCORRECTA` (productos sin línea siguen activables en cualquiera). Verificado con POST directo. Deuda #5 resuelta — cierra el vector que la UI ya filtraba pero el backend no validaba.
- **Backup manual** (`npm run db:backup` → `scripts/backup-db.ps1`): pg_dump de `DATABASE_URL` (sin imprimirla) a `backups/` (gitignoreado). **Pendiente del usuario: instalar PostgreSQL client tools** (el script lo indica con mensaje claro — verificado que falla limpio sin pg_dump). Mitiga la deuda #1; el plan Pro de Supabase sigue siendo decisión abierta.
- **Testing (deuda #7, base resuelta)**: Vitest instalado (`npm test` / `npm run test:watch`, `vitest.config.ts` con alias `@/`). **28 tests en 5 suites**, todos verdes: `fecha-planta` (formato y no-UTC), `lote-pt` (templates de nomenclatura, vencimiento sin overflow de setMonth), `lote.service` (validaciones y códigos de error, Prisma mockeado), `linea-producto-activo.service` (la de mayor valor: producto de otra línea, guard cooldown 30s, guard ventana 5/10min, camino feliz), `getTurnoByHora` (cruce de medianoche, límites inclusivo/exclusivo, DB caída). Convención: `*.test.ts` junto al archivo, Prisma siempre mockeado con `vi.mock("@/lib/prisma")` — sin DB real en tests unitarios. **Correr `npm test` antes de cerrar cualquier tarea de backend.**
- **Acción pendiente del usuario en `.env.local`** (bloqueado para el agente): `DEMO_MODE="false"` o `DEMO_USER_PASSWORD` random (deuda #4).
- **Revisión de `seguridad-analista`** sobre estos 4 cambios: aprobado con observaciones, sin veto. Se corrigió en el mismo pase el único hallazgo Medio accionable: `scripts/backup-db.ps1` pasaba la connection string completa (con password) como argumento de `pg_dump`, visible en el listado de procesos de Windows — ahora usa `$env:PGPASSWORD` (limpiada al final con `finally`) y flags separados (`--host/--port/--username/--dbname`). Deuda restante documentada en `docs/auditoria-2026-07.md` (#10, #11, #12): lockout DoS por email en el rate limiting (no urgente, red interna), enumeración de usuarios por timing en `authorize()`, backups sin cifrar en disco.

---

### [2026-07-15] - Auditoría liviana + solo módulo Calidad + Graphify

- **Auditoría liviana** (sin subagentes, para ahorrar tokens): `docs/auditoria-2026-07.md` — estado general, deuda consolidada priorizada (4 ítems pre-producción: backups Supabase, guard de boot DEMO_MODE, rate limiting de login, password demo débil), riesgos y recomendaciones de ahorro de tokens. De paso se corrigieron 2 líneas desactualizadas en `architecture.md` (deuda del selector ya resuelta; nombre viejo de Línea 3 en la precondición del import).
- **Reducción a solo módulo Calidad**: se quitaron las cards "Próximamente" de Producción y Depósito de la home (`src/app/page.tsx`) y se borraron sus páginas placeholder (`src/app/produccion/`, `src/app/deposito/` → ahora 404). **El schema NO se tocó** (enum `ModuloApp`, stub `OrdenProduccion`, `Lote.ordenProduccionId` siguen intactos): reactivar un módulo = volver a agregar la card + su page, sin migración. Cambio mecánico de UI, sin cadena de subagentes (criterio de cambio trivial).
- **Graphify instalado** (graphify.net, paquete PyPI `graphifyy` v0.9.16 — verificado como oficial, repo `safishamsi/graphify`): grafo de conocimiento local del repo en `graphify-out/` (378 nodos, 27 comunidades; extracción AST local con tree-sitter, sin LLM ni API keys). `graphify-out/` gitignoreado (regenerable con `graphify update .`). Skill de Claude Code registrado (`/graphify`) y sección nueva al tope del `CLAUDE.md` del repo: **consultar el grafo (`graphify query/explain/affected`) antes de leer archivos completos para explorar** — es el mecanismo principal de ahorro de tokens de exploración a partir de ahora.

---

### [2026-07-15] - Fix crítico: login demo con usuario fantasma rompía toda escritura

- **Contexto:** el usuario reportó "Error interno al activar el producto" (500) reproducible en el asistente. Yo no lo reproducía en mis pruebas — la diferencia era la sesión: el usuario entraba con la contraseña **demo** (`lacumbre2026`), yo con la real (`lacumbre`).
- **Causa raíz:** `src/lib/auth.ts`, branch `DEMO_MODE`, devolvía un usuario con `id` hardcodeado (`00000000-0000-0000-0000-000000000001`) que **no existe en la tabla `usuarios`** de Supabase — diseñado para cuando no había DB conectada, quedó obsoleto sin que nadie lo notara hasta ahora. Con DB real, cualquier escritura con FK a `usuarios` (`activadoPorId`, `creadoPorId`, `responsableId`) fallaba con P2003/500 para toda sesión demo — no solo la activación de producto, **todo** el flujo de escritura de la app estaba roto con esas credenciales.
- **Fix:** el branch demo ahora resuelve el usuario REAL por `DEMO_USER_EMAIL` contra la DB; si existe y está activo, la sesión usa su `id`/`rol` reales (las FK quedan íntegras, trazabilidad con el usuario verdadero). Si está inactivo o no existe, rechaza el login (`return null`) — el fantasma **no** es una vía para sortear una desactivación real (hallazgo de `seguridad-analista`, corregido antes de cerrar). Solo si la DB es inalcanzable cae al fantasma original.
- **Aprobado por `seguridad-analista`** con observaciones: se agregó `console.warn` visible en cada login por el path demo, y se actualizó `.env.example` (`DEMO_MODE` default `"false"`, nota de que `DEMO_USER_PASSWORD` debe ser un valor random fuerte, no predecible — con este fix es de facto una segunda contraseña del usuario real).
- **Verificado en browser** con las credenciales demo reales del usuario: activación de producto → `201` (antes `500`), `activadoPorNombre` correcto ("Ignacio Ovando"). Login con la contraseña real sigue funcionando sin cambios.
- **Lección para no repetir:** cuando se investigó el mismo síntoma la primera vez (FK de `creadoPorId` rota, hito de Alta de Lote), se lo esquivó re-logueando con el usuario real en vez de arreglar la causa — quedó vivo y volvió a aparecer acá. La próxima vez que una escritura falle con FK a `usuarios`, revisar primero con qué credenciales está logueada la sesión que falla.

---

### [2026-07-14] - Fix: selector de producto filtrado por línea productiva

- **Contexto:** el usuario reportó que el `<select>` del paso "producto" mostraba el catálogo completo de 104 productos sin importar la línea elegida (deuda ya documentada en ADR-012 desde el hito anterior).
- **Fix:** `ProductoOption` ganó `lineaProductivaId` (el campo ya venía en `getProductosActivos()`, solo faltaba propagarlo desde `puntos-control/page.tsx` hasta `CalidadModuloView.tsx`). El `<select>` ahora solo muestra productos de la línea activa + los que no tienen línea asignada en el maestro (mismo criterio que ya usaba la vieja `getLotesActivos`, retirada en un hito anterior).
- **Verificado en browser:** Línea 3 → 2 productos (Alfajor Negro, Tapas); Línea 0 → otro set de 8 (bizcochos, cookies, snacks) — confirma que el filtro es específico por línea, no global.
- Cambio contenido y de bajo riesgo (un campo propagado + un filtro client-side), sin tocar repository, services ni schema.

---

### [2026-07-14] - Asistente: siempre confirmar producto + filtro de familia derivado (sin chips)

- **Contexto y Objetivo:**
  Dos ajustes pedidos por el usuario sobre el asistente de 3 pasos del hito anterior: (1) el paso de selección de producto **NO debe saltearse** aunque la línea ya tenga uno activo — siempre hay que confirmarlo; (2) los **chips de familia sobran** — la familia ya está incluida en el producto elegido, así que el filtro de puntos de control tiene que derivarse solo de ahí, sin filtro manual.

- **Cambios:**
  - `ProductoActivoLinea` (`src/types/calidad.ts`) ganó `familiaSlug`, poblado desde `producto.familia.slug` en los includes del repository (`getProductoActivoDeLinea`, `activarProductoLinea`) y los dos mappers que aplanan el estado.
  - El paso "producto" del asistente ahora se muestra **siempre** al confirmar una línea, con el producto activo **preseleccionado** si existe (excepción única: la restauración por `?linea=` al volver "atrás" de un PC sigue saltando directo a la grilla — re-preguntar ahí sería fricción sin sentido, no una salvaguarda real).
  - Confirmar el mismo producto activo (`productoSeleccionado === productoActivo.productoId`) **no dispara `POST`** — va directo a la grilla sin registrar una activación redundante (evita ensuciar `LineaActivacionLog` y chocar con el cooldown del guard).
  - Se eliminaron los chips de familia de la grilla y el query param `?familia=` por completo. El filtrado de PCs se deriva de `productoActivo.familiaSlug`; el back link del punto de control y el dispatch del modo Tapitas en `PesoMedicionesForm` ahora reciben la familia server-side, no por URL.

- **Correcciones aplicadas tras revisión de `frontend-ux`** (aprobado con observaciones, ninguna marcada bloqueante formalmente, pero la primera choca con "integridad de datos" pedida por el usuario y se trató como tal):
  1. **Confirmar vs. cambiar producto se veían idénticos** (mismo botón "Avanzar", mismo card gris) — un mis-tap en el `<select>` podía disparar un changeover real sin que el operario lo notara. Ahora: si el producto elegido coincide con el activo, botón "Confirmar y avanzar"; si difiere, botón "Cambiar producto" + card en ámbar con aviso explícito de reemplazo y lote nuevo.
  2. **"Agregar otro producto" renombrado a "Cambiar producto"** — el label anterior sugería producción en paralelo, cuando en realidad reemplaza el producto activo (no hay soporte de multi-producto por línea).
  3. **Empty state de la grilla distingue "línea sin PCs configurados" de "ningún PC aplica a la familia del producto activo"** — antes ambos casos mostraban el mismo mensaje de "contactar al administrador", engañoso en el segundo caso.
  - Se descartó como no-bug el hallazgo sobre slugs "tapas"/"tapitas": es un valor legacy exclusivo del modo demo, ya documentado en el propio código (`PesoMedicionesForm.tsx`).

- **Verificado en browser:** preselección del producto activo al entrar al paso 2; botón "Confirmar y avanzar" cuando coincide; aviso ámbar "Vas a reemplazarlo..." al elegir otro producto; grilla sin chips, con Tapas activo se ocultan los PCs de Alfajor Negro y viceversa; "atrás" desde un PC restaura la grilla sin re-preguntar producto.

---

### [2026-07-14] - Rediseño UI: asistente de 3 pasos para Puntos de Control

- **Contexto y Objetivo:**
  El usuario pasó 3 vistas modelo (mockups) rechazando el diseño de "Producto activo por línea" del hito anterior (tabs de líneas + selector incrustado en una sola pantalla). Pidió un **asistente secuencial**: Vista 1 (elegir línea) → Vista 2 (elegir producto, lote automático) → Vista 3 (grilla de puntos de control, con "Cambiar de Línea" y "Agregar otro producto" para volver a los pasos anteriores). Cambio **100% de UI** en `CalidadModuloView.tsx` — cero cambios de schema, repository, services o endpoints (todo lo del hito anterior sigue vigente sin tocar).

- **Diseño:** máquina de 4 pasos `"cargando" | "linea" | "producto" | "grilla"`. Si la línea elegida ya tiene producto activo hoy, el paso "producto" se saltea automáticamente. Restauración por `?linea=` (volver de un PC) entra directo en el paso correspondiente sin mostrar pasos intermedios de por medio.

- **Correcciones aplicadas tras revisión de `frontend-ux`** (aprobado con observaciones, ninguna bloqueante, pero aplicadas por chocar con la integridad de datos que pidió el usuario):
  1. **Error en el fetch de producto activo ya NO se interpreta como "sin producto activo"** — antes un fallo de red silencioso podía llevar a que el operario active un producto por error y pise el que ya estaba activo para toda la línea. Ahora muestra mensaje + botón "Reintentar".
  2. **Refetch forzado al reconfirmar la misma línea** (`recargaNonce`) — no confía en el estado en memoria del cliente; otro operario pudo haber hecho un changeover mientras tanto.
  3. **Paso "cargando" dedicado** para la restauración por `?linea=` — antes el `<select>` del paso 1 quedaba tocable mientras resolvía el fetch, permitiendo que una elección del operario se descartara en pleno vuelo.
  4. **"Agregar otro producto"** pasó de link de texto sin padding a botón con target táctil real (`px-4 py-2.5`, borde rojo) — difícil de tocar con guantes en tablet.

- **Deuda conocida (documentada en ADR-012, no bloqueante):**
  - El label "Agregar otro producto" sugiere producción en paralelo pero en realidad **reemplaza** el producto activo de la línea (no hay soporte de multi-producto simultáneo). Aclarar el copy es decisión de UI; soportar productos simultáneos de verdad es regla de negocio y pasaría primero por `scm-alimentos`.
  - Estilos de card/botón duplicados entre los 3 pasos interactivos — candidato a extraer si el patrón se repite en otro módulo.
  - Mensajes de error del server se muestran tal cual al operario sin mapeo a copy amigable.

- **Verificado en browser:** Vista 1 → Línea 3 (con producto activo) → Avanzar → salta directo a Vista 3 con el banner correcto; "Cambiar de Línea" vuelve a Vista 1; restauración por `?linea=` cae directo en Vista 3.

---

### [2026-07-14] - Producto activo por línea (reemplaza el selector repetido en cada punto de control)

- **Contexto y Objetivo:**
  El usuario (dueño del producto, describiendo su propia operación de planta) pidió invertir el flujo de captura: en vez de preguntar "Producto en producción" dentro de cada uno de los 8 formularios (con un `<select>` propio y preselección heurística por form), preguntar UNA sola vez al entrar a la línea. Flujo nuevo: **Ingreso línea → Ingreso producto (lote se genera/reutiliza solo) → puntos de control.** Producto activo compartido por línea (no por usuario), único a la vez, cualquier operario lo puede definir/cambiar (queda registrado quién).

- **Decisiones de diseño (aprobadas por `arquitecto-industrial`):**
  - `Lote` ganó `lineaProductivaId` (nullable) + `@@unique([productoId, lineaProductivaId, fechaProduccion])` — habilita find-or-create: reactivar el mismo producto en la misma línea el mismo día **reutiliza** el lote (verificado en browser: Alfajor→lote A, Tapas→lote B, Alfajor de nuevo→mismo lote A).
  - Tabla nueva `LineaProduccionEstado` (puntero mutable, PK `lineaProductivaId`) — fuente de verdad que leen los 8 formularios. Tabla nueva `LineaActivacionLog` (append-only) — historial de cada activación, nunca se actualiza ni borra (confirmado por seguridad-analista con grep en todo el repo).
  - **Se retiró `getLoteEnCursoDeLinea`** (heurística vieja basada en `RegistroCalidad`) — reemplazada por lectura directa de `LineaProduccionEstado`. No convivían para evitar dos fuentes de verdad divergentes.
  - **Activar producto NO requiere rol de supervisión** (a diferencia de `POST /api/v1/calidad/lotes`, alta administrativa, que sigue gateada y no se tocó) — es "declaración operativa", no "veredicto de calidad". La trazabilidad de quién activó se cubre con `LineaActivacionLog`, no con gating de rol.
  - Migración: `prisma/migrations/20260714120000_linea_producto_activo/`. Documentado como **ADR-012** en `docs/architecture.md`.

- **Guard anti-abuso** (agregado tras hallazgo de `seguridad-analista` + decisión de `arquitecto-industrial` de que entra AHORA, no se difiere — activar producto mueve un puntero del que dependen 8 formularios en tiempo real, es integridad de trazabilidad, no rate limiting genérico):
  - Cooldown: `429 ACTIVACION_MUY_FRECUENTE` si el mismo usuario activó algo en la misma línea hace menos de 30s.
  - Ventana: `429 LIMITE_ACTIVACIONES_EXCEDIDO` si acumuló 5+ activaciones en la misma línea en 10 minutos.
  - Se apoya en `LineaActivacionLog` (sin caché en memoria, stateless). Verificado en browser: 2 POST consecutivos → 201 y luego 429.

- **Fix bloqueante de `backend-senior`:** race condition en `activarProductoLinea` — dos activaciones concurrentes del mismo producto/línea/día podían hacer que una de las dos reciba un 500 genérico en vez de reusar el lote que ganó la carrera. Corregido: ante colisión de la unique constraint, se re-busca el lote existente en vez de fallar (`esColisionLoteLinea`).

- **Fix bloqueante de `frontend-ux`:** el link "Cambiar producto" (dentro de cada formulario, vía `ProductoActivoBanner`) navegaba y abandonaba el formulario en curso sin avisar de datos sin guardar. Corregido: pide confirmación (`window.confirm`) antes de navegar — es una acción poco frecuente (changeover), el costo de la confirmación es bajo comparado con perder una jornada de muestras cargadas.

- **UI:** `CalidadModuloView.tsx` muestra el selector inline (agrupado por familia) si la línea no tiene producto activo hoy; con producto activo, banner + "Agregar otro producto". `/calidad/lotes/nuevo` y su botón **se retiraron de la navegación principal** (la ruta y el endpoint de alta administrativa siguen existiendo como building block interno, sin tocar).

- **Deuda conocida (no bloqueante, documentada en ADR-012):**
  - No se valida que `producto.lineaProductivaId` coincida con la línea que se activa (preexistente en el alta administrativa; se agrava porque ahora no hay gate de rol) — `backend-senior` lo dejó como decisión consciente, no lo bloqueó.
  - Rate limiting transversal del resto de endpoints de escritura sigue pendiente (el guard nuevo es puntual a este endpoint).
  - Selector de producto sin filtrar por línea/familia (104 productos, mucho scroll en tablet) — sugerencia de `frontend-ux`, no bloqueante.
  - Sin tests automatizados (mismo criterio que el resto del repo).

---

### [2026-07-13] - Limpieza de datos de prueba + Alta de Lote real + fix de navegación

- **Contexto y Objetivo:**
  Al probar contra Supabase real (hito anterior) aparecieron 3 problemas relacionados, que expusieron un vacío de fondo: **no existía ninguna forma de crear un `Lote` real** — solo se poblaba a mano en el seed. Este hito resuelve eso y cierra con la cadena de revisión completa (arquitecto → backend → seguridad → documentador).

- **Fase 1 — Limpieza de datos de prueba:**
  Se identificaron 2 productos ficticios (`ALF-ARC-001`, `ALF-LC-001`, inventados antes de tener el Excel real) y 2 lotes de prueba (`LC-2026-040`, `LC-2026-041`) sin correspondencia real, confirmados con el usuario y borrados de Supabase. `prisma/seed.ts` y `scripts/import-maestro-productos.ts` corregidos para usar "Línea 3" (nombre corto) en vez de "Línea 3 — Conformado Alfajores" — el usuario había renombrado/borrado líneas manualmente en Supabase en paralelo, causando colisión de `codigo` en el upsert.

- **Fase 2 — Alta de Lote (`/calidad/lotes/nuevo`):**
  Pantalla nueva (Server Component + `AltaLoteForm` Client Component) → `lote.service.ts` (valida Zod + producto activo) → `crearLote()` en `calidad.repository.ts` → Prisma. Endpoint `POST /api/v1/calidad/lotes`, restringido a `admin`/`jefe_planta`/`supervisor_calidad`. **`numeroLote` es un PLACEHOLDER temporal** (`GEN-{yyyyMMdd}-{HHmmss}`, reintenta hasta 3 veces ante colisión) — las reglas reales de numeración las va a dar el usuario más adelante. Documentado como ADR-011 en `docs/architecture.md`, incluyendo la distinción con `Producto.nomenclaturaLote` (lote de PT en el pallet, concepto distinto).
  - **Gap de auditoría resuelto** (escalado a `arquitecto-industrial`): `Lote` no tenía forma de registrar quién lo creó. Se agregó `creadoPorId` (FK nullable a `Usuario`, `onDelete: SetNull`) — migración `20260713184453_add_lote_creado_por`. Nullable porque a futuro puede haber lotes generados automáticamente (Orden de Producción) sin usuario humano detrás.
  - **Riesgo residual señalado por `seguridad-analista`** (severidad Alta, no bloqueante): si algún día se implementa borrado FÍSICO de `Usuario`, el `onDelete: SetNull` blanquea la autoría del lote sin dejar rastro. **Verificado: hoy no existe ningún `usuario.delete()` físico en el código** (borrado de usuarios es lógico vía `activo`), así que el riesgo es teórico por ahora — **si en el futuro se agrega borrado físico de `Usuario`, revisar este `onDelete` antes** (agregar log de auditoría append-only para alta de lote, o cambiar a `Restrict`).
  - Status HTTP mapeado por `code` (`VALIDACION_ESTRUCTURA`→400, `PRODUCTO_NO_ENCONTRADO`→404, `PRODUCTO_INACTIVO`→409, `ERROR_INTERNO`→500) y chequeo de rol extraído a `src/lib/auth/roles.ts` (compartido entre el endpoint y la página), por observaciones de `backend-senior`.

- **Fase 3 — Fix de navegación "atrás":**
  Volver desde un punto de control ya no resetea a la pestaña por defecto — el back link pasa `linea`/`familia` como query params (`?linea=...&familia=...`), y `CalidadModuloView` los usa para restaurar el `useState` inicial. Limitación conocida y aceptada: cambios manuales de tab no sincronizan de vuelta a la URL (solo siembran el estado inicial).

- **Deuda conocida (no bloqueante, ya documentada en `architecture.md`):**
  - Colisión de timestamp en `GEN-...` bajo alta concurrencia (aceptado: alta de lote es acción manual de baja frecuencia).
  - Sin rate limiting en el endpoint (señalado por seguridad, deuda transversal del repo).
  - Cero tests automatizados (mismo criterio que el resto del repo).
  - **Halladas por `documentador` al cerrar, sin relación con esta feature**: (1) el doc de arquitectura decía que no existían migrations formales — ya no es así, hay 2 migraciones reales; falta un ADR que documente conscientemente la transición de `db push` a migrations versionadas. (2) tercera instancia del patrón "fallback demo no gateado por `DEMO_MODE`" (`DEMO_PRODUCTOS` en `lotes/nuevo/page.tsx`, mismo antipatrón de ADR-007 repitiéndose).

---

### [2026-07-13] - UX de captura (producto persistente, numpad, tiempo túnel) + Base de datos real en Supabase

- **Contexto y Objetivo:**
  Dos frentes: (1) tres correcciones de UX en los formularios táctiles reportadas por el usuario tras probar en tablet, con cadena de revisión frontend-ux + backend-senior; (2) primera conexión a una base de datos real (Supabase) y migración fuera de "modo demo" — hito planificado para la semana del 13 de julio.

- **Decisiones Clave de Diseño (UX):**
  - **"Producto en producción"** reemplaza al viejo label "Lote de producción" en los 7 forms + Trazabilidad Insumos — el operario reconoce el producto, no el número de lote. Texto de opción: `{productoNombre} — Lote {numeroLote}`. `getLotesActivos(familiaSlug?, lineaProductivaId?)` ahora también filtra por línea.
  - **Lote del día persistente**: `getLoteEnCursoDeLinea(lineaProductivaId, fecha)` en `calidad.repository.ts` — toma el `loteId` del último `RegistroCalidad` de la línea en el día (desempate por `createdAt`, no solo `hora`). Se preselecciona en todos los forms (`loteInicialId` prop) pero queda **editable**; helper visual "Tomado del registro del día" que deja de mostrarse apenas el operario lo cambia a mano (`loteTocado` state).
  - **Numpad industrial**: el listener de cierre pasó de `pointerdown` a `click` en **fase de captura** — un gesto de scroll ya no cierra el teclado (antes sí, porque pointerdown/up sin click ocurre en cada scroll táctil). Se restauró la tecla ⌫ (existía el handler pero no estaba en la grilla — bug preexistente).
  - **Tiempo de Túnel en Control Temperatura Condensación**: mismo patrón "una vez por jornada" que ya existía en Producción Diaria (viaja en la primera entrada del batch). Si se cierra el numpad del túnel sin tocar OK, el valor se descarta — evita duplicar el registro de jornada.
  - **Bug de timezone corregido (bloqueante)**: todos los forms calculaban `fecha` con `new Date().toISOString().split("T")[0]` → día **UTC**, mientras el backend ya usaba hora de planta (Argentina, UTC-3). Entre las 21:00 y las 00:00 esto desalineaba "hoy" entre cliente y servidor — rompía la numeración de muestras, el lote persistente y "registros de hoy" en turno noche. Centralizado en `src/lib/calidad/fecha-planta.ts` (`hoyPlanta()`, `horaPlanta()`) — **usar SIEMPRE este helper para fecha/hora en el módulo de Calidad, nunca `new Date().toISOString()` directo.**

- **Decisiones Clave (Base de Datos):**
  - **Proveedor: Supabase** (Postgres gestionado), elegido por ser la alternativa gratuita a esta escala. Se evaluó DigitalOcean Managed Postgres como alternativa "más pelada" — Supabase gana por el panel de administración de datos que cubre el hueco de "no hay UI de admin del maestro" (ADR-010).
  - **Caveats del free tier de Supabase, aceptados conscientemente**: se pausa tras 7 días de inactividad (hay que despertarlo manualmente); **sin backups automáticos / point-in-time recovery** hasta el plan Pro (~USD 25/mes) — pendiente evaluar antes de que haya datos reales de producción/exportación cargados. No usar como excusa para no tener un plan de backup.
  - **Dos connection strings de Supabase, uso distinto**: el **pooler de transacciones** (puerto 6543) NO soporta los locks de sesión que necesita `prisma migrate` — se cuelga sin error visible. Para migraciones hay que usar la **conexión directa** (puerto 5432). Hoy `DATABASE_URL` en `.env.local` apunta a la directa (aceptable a esta escala de usuarios); **cuando se despliegue en un hosting serverless (Vercel u otro) hay que volver al pooler para el runtime y separar una `DIRECT_URL` solo para migraciones** — no lo hagas antes de que sea necesario, pero no lo olvides.
  - **`prisma.config.ts` va en la RAÍZ del repo, no dentro de `prisma/`** — Prisma 7 no lo encuentra ahí. Contiene `datasource.url` leído de `DATABASE_URL` (con dotenv cargando `.env.local` manualmente, porque el CLI de Prisma no lo hace solo).
  - Primera migración real: `prisma/migrations/20260713164001_init/` — a partir de acá, **toda modificación de schema pasa por `prisma migrate dev`**, nunca más `db push` contra esta base.

- **Restricciones Estrictas (agregadas):**
  - **NUNCA** usar `new Date().toISOString().split("T")[0]` o `new Date().toTimeString()` para fecha/hora de un registro de calidad — usar `hoyPlanta()`/`horaPlanta()` de `src/lib/calidad/fecha-planta.ts`.
  - **NUNCA** correr `prisma migrate` contra el pooler de transacciones (6543) de Supabase — usar la conexión directa (5432) o una `DIRECT_URL` separada.
  - **NUNCA** volver a `db push` en esta base — ya hay migración inicial versionada, todo cambio de schema es una migración nueva.

- **Estado tras verificación en browser (login real, no demo):**
  - Seed corrido: usuarios, turnos, líneas 0/1/2/3 + Envasado/Masa, 11 puntos de control.
  - Import del maestro real (`npm run db:import-productos`): **102 productos creados + 2 actualizados = 106 total, 14 familias, 17 marcas**, sin warnings.
  - Verificado: login, listado de puntos de control con familias reales desde DB (ya no hardcodeadas), formulario de Peso Alfajor mostrando los 2 lotes reales de seed con su producto. Sin errores de consola.
  - **Pendiente**: probar el guardado de un registro de punta a punta contra la DB real (solo se verificó lectura hasta el momento de este hito).
  - **Deuda ya conocida sin resolver** (ver hitos previos): unicidad/idempotencia de registros (unique con NULL no protege — ver ADR pendiente con arquitecto-industrial), rate limiting en login, política de backup de Supabase antes de producción real.

---

### [2026-07-01] - Arquitectura inicial y módulo de Calidad — Hito fundacional

- **Contexto y Objetivo:**
  Sistema de control de producción para La Cumbre (fábrica de alfajores). Punto de partida: digitalizar planillas de papel del área de Calidad. El primer módulo cubre la Línea 3 (conformado y bañado de alfajores) con sus 8 puntos de control reales.

- **Decisiones Clave de Diseño:**
  - **Stack:** Next.js 14 App Router + TypeScript + Tailwind v4, Prisma 7 con `@prisma/adapter-pg`, PostgreSQL.
  - **Patrón JSONB extensible:** La tabla `registros_calidad` almacena datos de formulario en un campo `data: Json`. Cada `punto_control` define su `schema_json` (JSON Schema). AJV valida los datos al guardar. **Esta es la decisión más crítica del proyecto:** permite agregar nuevos campos o puntos de control sin migraciones de schema.
  - **TipoFormulario enum:** determina qué componente React renderiza el formulario. Dispatch en el frontend por `tipoFormulario`, nunca por nombre del punto de control.
  - **Turno auto-resolution:** el service layer detecta el turno según la hora del registro comparando con `turnos.hora_inicio/hora_fin`. El operador no selecciona turno manualmente.
  - **Auth split para Edge runtime:** `auth.config.ts` (Edge-safe, sin Prisma, usado por middleware) + `auth.ts` (Node.js, con Prisma + bcrypt, usado por API routes). Crítico: si se fusionan en un solo archivo, el middleware crashea con `crypto module not available`.
  - **Credenciales demo:** ~~`iovando@lacumbre.com.ar / lacumbre` hardcodeadas en `auth.ts`~~ **SUPERADO el 2026-07-07** — ver hito de esa fecha: ahora gateadas por `DEMO_MODE=true` + `DEMO_USER_EMAIL`/`DEMO_USER_PASSWORD` en `.env.local` (ADR-007 en `docs/architecture.md`). No reintroducir literales en código.
  - **Batch atómico:** `createRegistrosBatchDB` usa `prisma.$transaction()` para guardar todas las muestras + entradas de auditoría en una sola transacción.
  - **Soft-delete HACCP:** `RegistroCalidad` tiene `deletedAt/deletedById`. Nunca se elimina físicamente un registro de calidad (requerimiento de inocuidad alimentaria).
  - **Auditoría append-only:** tabla `AuditoriaRegistro` — ningún registro se modifica ni elimina jamás. Registra quién hizo qué, cuándo, con snapshot antes/después.
  - **LoteEstadoLog:** cada transición de estado de un lote queda registrada permanentemente.

- **Restricciones Estrictas:**
  - **NUNCA** crear una tabla por cada punto de control de calidad. Todo va en `registros_calidad.data` (JSONB).
  - **NUNCA** eliminar físicamente registros de calidad. Solo soft-delete con motivo.
  - **NUNCA** modificar registros en `AuditoriaRegistro`. Es append-only por ley (HACCP).
  - **NUNCA** importar `auth.ts` (con Prisma) desde `middleware.ts`. Solo `auth.config.ts`.
  - **NUNCA** editar migraciones ya aplicadas. Solo crear nuevas.
  - **NUNCA** hardcodear lógica de formulario por nombre de punto de control — siempre usar `tipoFormulario` como discriminador.
  - No usar `any` en TypeScript sin comentario explicativo.
  - Las respuestas de API siguen el contrato `{ data }` en éxito o `{ error, code }` en fallo.

- **Archivos Modificados o Involucrados:**
  - `prisma/schema.prisma` — schema completo con HACCP, soft-delete, enums expandidos
  - `prisma/seed.ts` — 10 puntos de control reales con JSON Schemas, usuarios, productos, lotes
  - `src/lib/auth.config.ts` — config Edge-safe (sin Prisma)
  - `src/lib/auth.ts` — Credentials provider con Prisma + demo user
  - `src/middleware.ts` — usa `authConfig` (Edge-safe)
  - `src/db/calidad.repository.ts` — CRUD + audit + soft-delete + batch transaction
  - `src/app/calidad/page.tsx` — hub de funcionalidades del área de Calidad
  - `src/app/calidad/puntos-control/page.tsx` — grilla de líneas y puntos de control
  - `src/components/calidad/CalidadModuloView.tsx` — vista con tabs por línea productiva
  - `src/components/calidad/RegistroCalidadForm.tsx` — dispatch por `tipoFormulario`

- **Estado Actual y Pendientes:**
  - ✅ Schema de DB completo (HACCP, auditoría, soft-delete, LoteEstadoLog)
  - ✅ Auth funcional con demo user (sin DB) + split Edge/Node
  - ✅ Hub `/calidad` con 4 áreas (1 activa: Puntos de Control)
  - ✅ `/calidad/puntos-control` con tabs por línea, 8 PCs de Línea 3 en demo
  - ✅ Seed completo con 10 PCs reales y sus JSON Schemas
  - ⏳ **Formularios especializados pendientes** (caen en `RegistroGenericoForm`):
    - `peso_alfajor` / `peso_relleno` / `peso_bano` → numpad con 12 mediciones + estadísticas en vivo
    - `temperatura_condensacion` / `temperatura_tanques` → formulario de temperatura
    - `detector_metales` / `fechado_envase` → botones C/NC con checklist
    - `produccion_diaria` → formulario de conteo continuo
  - ⏳ Conectar DB real: `npx prisma migrate dev --name init` → `npm run db:seed`
  - ⏳ Componente numpad industrial (táctil, dígitos grandes, para tablets de planta)
  - ⏳ Estadísticas en vivo al ingresar muestras (promedio, fuera de spec)
  - ⏳ RBAC por módulo (hoy solo se verifica `session.user.id`, no rol+módulo)
  - ⏳ Offline-first / service worker para WiFi inestable en planta

- **Memoria:** Antes de sugerir cambios grandes, releer este archivo para entender el histórico de decisiones y restricciones del proyecto. El patrón JSONB es intencionalmente flexible — cualquier propuesta de crear tablas nuevas por punto de control viola la arquitectura acordada.

---

### [2026-07-02] - Auditoría completa del repo (arquitecto + backend + frontend + seguridad)

- **Contexto y Objetivo:**
  Auditoría de cuatro agentes en cadena antes de continuar sumando features. El proyecto es **pre-producción / modo demo** — no hay usuarios reales operando todavía.

- **Decisiones Clave de Diseño:**
  El arquitecto confirmó que las decisiones de fondo son correctas (JSONB extensible, separación de capas, HACCP, distinción de línea de negocio en el modelo). El backend fue rechazado por dos bugs críticos que se corrigieron. Seguridad emitió VETO sobre dos hallazgos que también se corrigieron.

- **Hallazgos corregidos (todos en esta sesión):**
  - **[S1/A1]** Credencial hardcodeada (`iovando@lacumbre.com.ar / lacumbre`) eliminada de `src/lib/auth.ts`
  - **[S2/A2]** Middleware actualizado para proteger `/api/v1/` además de las rutas de página
  - **[B2/S9]** `createRegistroCalidad` en el repo ahora genera entrada en `auditoria_registros` atómicamente
  - **[B1]** `catch {}` silencioso en `getTurnoByHora` reemplazado por log + rethrow
  - **[F1]** `responsableId` hardcodeado eliminado de `RegistroGenericoForm` — inyectado server-side
  - Resto de hallazgos importantes y mejoras resueltos en la misma pasada

- **Restricciones Estrictas:**
  - **NUNCA** volver a hardcodear credenciales en código fuente, ni para demo. El usuario demo debe existir solo en `prisma/seed.ts` con bcrypt.
  - **NUNCA** excluir `/api/v1/` del matcher del middleware. Solo `/api/auth/` puede ser excepción.
  - **NUNCA** hacer `catch {}` vacío en funciones del repositorio — siempre loguear y relanzar.
  - El `responsableId` se inyecta **siempre** server-side desde la sesión. Nunca viene del cliente.

- **Pendientes clasificados post-auditoría:**
  - 🟠 Rate limiting en login (`/api/auth/callback/credentials`)
  - 🟠 Headers de seguridad HTTP en `next.config.mjs` (CSP, HSTS, X-Frame-Options)
  - 🟠 Verificación de rol en endpoints (RBAC por módulo/línea)
  - 🟠 `fuenteOrigen` forzado a `"tablet"` server-side en endpoint individual
  - 🟡 Índice GIN en `registros_calidad.data` (cuando haya volumen real)
  - 🟡 `TipoFormulario` enum → evaluar mover dispatch al `schema_json`
  - 🟡 `OrdenProduccion` stub → completar antes de Fase 2
  - 🟡 Backspace en `NumpadIndustrial`, confirmación en eliminar muestra, tabs de 44px

- **Archivos Modificados o Involucrados:**
  - `src/lib/auth.ts`, `src/middleware.ts`
  - `src/db/calidad.repository.ts`
  - `src/components/calidad/RegistroGenericoForm.tsx`
  - `src/services/calidad/registro.service.ts`

- **Memoria:** Antes de sugerir cambios grandes, leer `docs/LOG_CONTEXTO.md`.

---

### [2026-07-01] - Formularios de peso con numpad industrial

- **Contexto y Objetivo:**
  Implementar los formularios especializados para `peso_alfajor`, `peso_relleno` y `peso_bano` — los tres PCs más frecuentes de Línea 3. El formulario genérico no era adecuado para uso en tablet en planta: inputs pequeños, sin teclado numérico grande, sin estadísticas en vivo.

- **Decisiones Clave de Diseño:**
  - **Un solo componente `PesoMedicionesForm`** para los tres tipos de peso, configurado por un objeto `CONFIG` keyed por `tipoFormulario`. Evita duplicar ~300 líneas por variante.
  - **Numpad como componente separado `NumpadIndustrial`**: panel fijo en bottom, botones grandes (h-14), auto-avance al OK (P1→P2→...→P12→cerrar). Diseñado para uso con guantes.
  - **`campoActivo` como estado unificado**: `{ origen: "medicion", idx }` o `{ origen: "extra", campo }`. El mismo numpad sirve tanto para las 12 mediciones como para campos extra (temp_bano, escurrimiento, etc.).
  - **Estadísticas en vivo** con `useMemo`: promedio, min, max, DE — se recalculan con cada keystroke del numpad.
  - **`stopPropagation` en el wrapper del numpad**: el outer div tiene `onClick → setCampoActivo(null)` para cerrar al tocar fuera, pero el numpad necesita su propio wrapper con `stopPropagation` para que sus botones no cierren el panel.
  - **Guardado como 1 registro por muestra** (no 12 filas): `data.mediciones = [v1..v12]` como array. Diferente a `DefectosConformadoForm` que guarda 12 filas por muestra con `filaProd`. Ambas estrategias son válidas — el schema JSON dicta cuál usar.

- **Restricciones Estrictas:**
  - No usar inputs `<input type="number">` para las mediciones — usar el `NumpadIndustrial` siempre. Los inputs nativos son inutilizables en tablets de planta.
  - No mezclar la lógica de cierre del numpad (click-outside en outer div) con los botones del propio numpad — siempre usar `stopPropagation` en el wrapper.
  - El avance automático (OK en P11 → P12, OK en P12 → cerrar) es intencional y no debe eliminarse.

- **Archivos Modificados o Involucrados:**
  - `src/components/calidad/NumpadIndustrial.tsx` (nuevo)
  - `src/components/calidad/PesoMedicionesForm.tsx` (nuevo)
  - `src/app/calidad/[lineaId]/[puntoControlId]/page.tsx` — dispatch actualizado con `TIPOS_PESO` Set y rama adicional; demo data actualizada con los IDs correctos

- **Estado Actual y Pendientes:**
  - ✅ `peso_alfajor`, `peso_relleno`, `peso_bano` → `PesoMedicionesForm` funcionando
  - ✅ Numpad con auto-avance P1→P12 verificado en browser
  - ✅ Estadísticas en vivo (promedio, min, max, DE) verificadas
  - ✅ Campos extra de `peso_bano` (T° ambiente, T° baño, escurrimiento) con numpad
  - ✅ Campos extra de `peso_relleno` (presencia_bob C/NC, penetrometría)
  - ⏳ Pendientes de formularios especializados: `temperatura_condensacion`, `temperatura_tanques`, `detector_metales`, `fechado_envase`, `produccion_diaria`
  - ⏳ Conectar DB real: `npx prisma migrate dev --name init` → `npm run db:seed`

- **Memoria:** Antes de sugerir cambios grandes, leer `docs/LOG_CONTEXTO.md`.

---

### [2026-07-07] - Maestro de productos v2 — alineado al Excel real

- **Contexto y Objetivo:**
  El usuario compartió su maestro de productos real (`Productos.xlsx`, hoja "BD", 104 productos) y pidió rediseñar `Producto` para simplificar la futura integración con la DB. Diseño aprobado por `arquitecto-industrial`; cadena completa de revisión (backend-senior → frontend-ux → seguridad-analista, sin veto) → documentador.

- **Decisiones Clave (confirmadas con el usuario):**
  - **Familia** es tabla (`Familia`: slug+nombre), no enum — crece con el catálogo (~16 familias reales) y los puntos de control la referencian vía tabla puente `PuntoControlFamilia`. Reemplaza el hardcodeo `FAMILIAS_LABELS` / `familias: string[]` del frontend.
  - **Línea de negocio** (`LineaNegocio`: marca_propia|copacker_arcor|fason_terceros) vive en `Marca`, NO en `Producto` — es atributo de la relación comercial, no del SKU. Mapeo confirmado: ARCOR y GOAT → copacker_arcor; LC → marca_propia; el resto (14 marcas) → fason_terceros.
  - **`Producto` rediseñado 1:1 al Excel**: `sku` nullable+unique (34/104 sin código — SKU falso es peor que null en trazabilidad de exportación), `nombre` unique = descripción std completa, FKs familia/marca (requeridas) + lineaProductiva (opcional), `pesoGramos`/`unidadesPorCaja` como Decimal (semielaborados traen no enteros, ej. TAPAS=751,87), `rendimientoTeorico`, `unidadRendimiento`, `cajasPorPallet`, `pesoMasaCrudaG`, `esSemielaborado`, `observaciones`, `descripcionVieja`.
  - **Enums `LineaProducto` y `TipoCliente` ELIMINADOS** — confirmado por grep que nadie los consumía en `src/`.
  - **Líneas 0/1/2 del Excel** se crean como `LineaProductiva` nuevas con `codigo Int? @unique`; Línea 3 del Excel = la existente "Línea 3 — Conformado Alfajores" (recibe `codigo: 3`).
  - **SKU duplicado en maestro origen** (`MADA200C12(B)` x2): NINGUNA fila lo conserva — ambas entran con `sku: null` + nota en `observaciones`.
  - **Import**: `npm run db:import-productos [ruta]` (default Desktop), one-shot idempotente (upsert por `nombre`), parsea "Familia; Gusto; Marca; Peso; UxCaja", normaliza coma decimal, "NA"→null, detecta semielaborado por texto en OBS, warnings por fila sin abortar el import completo.

- **Bugs corregidos durante la cadena de revisión (no reintroducir):**
  - `getLotesActivos(familiaSlug?)` filtra en el WHERE de Prisma, NO post-`take(100)` en JS — con >100 lotes activos, filtrar después de paginar dejaba familias enteras invisibles en el selector.
  - Catch de `[lineaId]/[puntoControlId]/page.tsx` ya NO mezcla un punto de control real con lotes demo: si el PC no está en `DEMO_RELACIONES`, se relanza el error (`throw`) en vez de renderizar un form real con lotes falsos (riesgo: registro HACCP apuntando a FK inexistente).
  - Ruta default del import corregida: `path.join("C:\\", ...)` — `path.join("C:", ...)` genera drive-relative path que Node resuelve contra el cwd, no la raíz del disco.
  - `vidaUtilMeses` del producto GOAT en el seed alineado al Excel (4 meses, no 9 — el `update` y el `create` estaban en conflicto).
  - Índices agregados: `Lote(productoId)`, `Lote(estado, fechaProduccion)`, `Producto(lineaProductivaId)` — sin ellos, `getLotesActivos` escanea tabla completa.
  - Nuevo `src/app/calidad/error.tsx`: nunca interpola `error.message` (evita filtrar detalles de Prisma/DB al operario).

- **Archivos Modificados o Creados:**
  - `prisma/schema.prisma` — Marca, Familia, PuntoControlFamilia, Producto rediseñado, LineaProductiva+codigo, índices.
  - `scripts/import-maestro-productos.ts` (NUEVO) — import one-shot.
  - `prisma/seed.ts` — 3 marcas + 2 familias base + 4 productos demo v2 + relaciones puntos_control_familias.
  - `src/db/calidad.repository.ts` — getLotesActivos(familiaSlug?), getLineasConPuntosControl con include de familias.
  - `src/components/calidad/CalidadModuloView.tsx` — familias como `{slug, nombre}`, labels desde DB.
  - `src/app/calidad/puntos-control/page.tsx`, `src/app/calidad/[lineaId]/[puntoControlId]/page.tsx` — wiring de familias reales.
  - `src/app/calidad/error.tsx` (NUEVO).
  - `package.json` — devDependency `xlsx`, script `db:import-productos`.

- **Estado Actual y Pendientes:**
  - ✅ Schema, import, seed, frontend y repository completos. Typecheck limpio. Verificado en browser (modo demo, modo tapitas, sin errores de consola).
  - 🟠 **Sin migrations formales** (`prisma/migrations/` no existe) — bloqueante antes de tocar un entorno con datos reales. Hoy: `prisma generate` + `db push` en dev.
  - 🟠 El "modo demo" embebido en el catch de `[lineaId]/[puntoControlId]/page.tsx` necesita decisión de arquitecto: ¿gatearlo por `DEMO_MODE` explícito en vez de vivir en cada catch de page? (mismo patrón pendiente que el de registros del día).
  - 🟠 Rate limiting en `authorize()` de NextAuth — no bloqueante hoy (red interna), resolver antes de exponer el login afuera.
  - ⏳ Fases futuras dictaminadas por arquitecto: pantalla admin del maestro, auditoría append-only de Producto/Marca/Familia, BOM semielaborado→PT (TAPAS como insumo de ALFAJOR), rendimientoTeorico en planificación de capacidad (pasa por scm-alimentos primero), tabla clientes separada de marcas.
  - **Import real pendiente**: correr `npm run db:import-productos` contra una DB real conectada (hoy solo se verificó el parseo de las 104 filas, sin DB).

---

### [2026-07-07] - Persistencia, registros del día, correcciones de formularios y Trazabilidad Insumos

- **Contexto y Objetivo:**
  8 correcciones de reglas de negocio pedidas por el usuario, auditadas por scm-alimentos y con cadena completa de revisión (backend-senior, frontend-ux, arquitecto-industrial, seguridad-analista con veto levantado, documentador).

- **Decisiones Clave (resueltas con el usuario):**
  - Fechado de envase: queda en papel, eliminado del módulo digital (FechadoEnvaseForm.tsx borrado; enum fechado_envase se conserva; PC desactivado en seed).
  - Peso baño: promedio de RESTAS APAREADAS (P_i c/baño − P_i s/baño, última muestra de cada tipo). Sin "Solo baño". Resumen de jornada con promedio baño + peso tapa + temps + escurrimiento.
  - Pallet: correlativo automático por día (cliente deriva max+1 del GET del día — diseño objetivo server-side pendiente, ver abajo).
  - Trazabilidad insumos: un registro POR CAMBIO DE LOTE (no por turno). Insumos: tapas_banadas, bonobon, dulce_de_leche, bano_chocolate. Nuevo TipoFormulario trazabilidad_insumos + TrazabilidadInsumosForm + demo-pc-10.
  - Tanques: 4 campos — temp_ddl, temp_bon_o_bon, tanque_1_cobertura, tanque_2_cobertura (chocolate blanco/leche eliminados).
  - Relleno: dulce_de_leche / bonobon / ddl_bob / otros (+ tipo_relleno_otro obligatorio con "otros").
  - Condensación: sin selector de tipo de producto; tabla "Resumen de la sesión".
  - Producción Diaria: vencimiento derivado de Producto.vidaUtilMeses (MM/yyyy); lote PT sugerido por Producto.nomenclaturaLote (tokens {yyyyMMdd}/{ddMMyy}/{correlativo}, derivado EN RENDER no con useEffect); tiempo_tunel_min una vez por turno (primera entrada del batch); pallet_incompleto flag.

- **Infraestructura nueva:**
  - `src/components/calidad/RegistrosDelDia.tsx`: hook useRegistrosDelDia(pcId, lineaId, refreshKey, enabled) + componente con renderItem custom. `enabled=false` cuando los registros vienen por prop (evita doble fetch). Integrado en TODOS los forms.
  - `src/lib/calidad/lote-pt.ts`: generarLotePT + calcularVencimiento (cálculo directo de mes, SIN setMonth — overflow 31/05+9m corregido; throw en vidaUtilMeses inválido).
  - GET /api/v1/calidad/registros con puntoControlId+fecha → getRegistrosDelDia. Default "hoy" en America/Argentina/Cordoba (NO toISOString — bug de turno noche corregido).
  - useBatchGuardar(redirectTo, onExito) — callback para refrescar la lista tras guardar.
  - Fix reglas de hooks en PesoMedicionesForm: wrapper sin hooks elige tapitas vs standard.
  - Hora de guardado fresca (no la de montado del form) salvo edición manual — Producción Diaria y Trazabilidad.

- **Seguridad (CRÍTICO corregido — no reintroducir):**
  - El usuario demo hardcodeado en src/lib/auth.ts FUE ELIMINADO. Ahora gated por NODE_ENV!=production AND DEMO_MODE=true AND DEMO_USER_EMAIL/DEMO_USER_PASSWORD (env vars). El usuario debe definirlas en .env.local para que el login demo funcione.
  - Catch del GET: { data: [] } SOLO si DEMO_MODE=true; si no, 503 { error, code: "DB_NO_DISPONIBLE" }.

- **Pendientes estructurales (dictamen arquitecto-industrial, NO implementados):**
  - 🟠 Tabla secuencias_diarias (linea, fecha, tipo, ultimoValor) con ON CONFLICT..RETURNING para asignar pallet_numero y nroMuestra SERVER-SIDE en la transacción; índice único funcional (linea, fecha, data->>'pallet_numero') WHERE deleted_at IS NULL; POST deja de aceptar esos campos del cliente. Bloqueante antes de tener >1 tablet por línea o SCADA escribiendo.
  - 🟠 DEMO_MODE completo: eliminar try/catch→demo de las pages, banner UI "datos de demostración", guard de boot (production+DEMO_MODE → abort).
  - 🟠 Autorización por rol/línea en el GET (hoy toda sesión ve todas las líneas) — decidir antes de dar acceso a terceros.
  - 🟠 Deuda UX no bloqueante: targets 44px en botones de eliminar + confirmación, scrollIntoView de errores, lotes[0] preseleccionado con >1 lote activo.
  - 🟠 Tests de lote-pt.ts (31/05+9m, 31/01+1m, correlativo 100, template sin tokens).

---

### [2026-07-02] - UX: navegación, tabs, secciones, filtro familia y modo tapitas

> **Nota de recuperación (2026-07-16):** el resto de este hito (y cualquier contenido que hubiera después, si lo había — este era el último hito del archivo, con 511 líneas totales) se perdió por un error de herramienta durante la sesión del 2026-07-16 (un `Write` completo sobre el archivo, basado en una lectura parcial). Lo de arriba se reconstruyó con precisión a partir de una lectura completa hecha minutos antes en la misma sesión. Lo que sigue (últimas ~90 líneas del archivo original) no se pudo recuperar — no se inventó contenido para rellenar el hueco. Si tenés este hito en otro lado (chat, notas), decime y lo reconstruyo textual.

- **Contexto y Objetivo:**
  Correcciones de UX y reestructuración de la grilla de puntos de control para reflejar la organización real de planta. Análisis de planillas físicas de Tapitas para implementar el modo tapitas en el formulario de peso baño.

- **Decisiones Clave de Diseño:**
  - **Back button** apunta a `/calidad/puntos-control`, no a `/calidad`. El hub `/calidad` es un nivel más arriba.
  - **Tabs por número de línea** ("Línea 1", "Línea 2", "Línea 3"), no por descripción ("Línea de Masa", "Línea de Envasado"). Cada línea tiene su propio conjunto de PCs.
  - **Secciones dentro de una línea**: Línea 3 tiene "Dosificado" y "Salida del Túnel". La sección viene del campo `seccion` del punto de control. Las secciones se renderizan con un header divisor y contador.
  - **Filtro de familia de productos**: chips "Todos / Alfajor / Tapitas" sobre la grilla. Cada PC tiene campo `familias: string[]` — PCs con array vacío siempre se muestran; PCs con familias específicas se ocultan si no coinciden. El filtro se resetea al cambiar de línea.
  - **Query param `?familia=tapitas`**: el link desde `PuntoControlCard` incluye `?familia=X` cuando `familiaActiva !== "todas"`. La page.tsx lo lee desde `searchParams` y lo pasa como prop a los forms.
  - **`PesoMedicionesForm` con rama tapitas**: cuando `tipoFormulario === "peso_bano" && familia === "tapitas"`, renderiza `PesoBanoTapitasMode` — 3 filas independientes (TAPA / TAPA C/BAÑO / BAÑO), 12 celdas cada una, auto-advance TAPA P1→P12 → TAPA C/BAÑO P1→P12 → BAÑO P1→P12, stats por fila. El payload guarda `mediciones_tapa`, `mediciones_tapa_con_bano`, `mediciones_bano`, `familia: "tapitas"`.
  - **Trazabilidad TAPAS**: NO va en Calidad como punto de control. Va en el futuro módulo de Lotes como "Abrir lote" — es un documento 1:1 con el lote, con firma de 3 turnos. Estructura muy diferente a los PCs de calidad (mediciones repetidas por hora).

- **Reorganización de demo-pc IDs (Línea 3):**
  - demo-pc-1: peso_alfajor — Dosificado — familias: ["alfajor"]
  - demo-pc-2: peso_relleno — Dosificado — familias: ["alfajor"]
  - demo-pc-3: peso_bano — Dosificado — familias: ["alfajor", "tapitas"]
  - demo-pc-4: temperatura_tanques — Dosificado — familias: []
  - demo-pc-5: temperatura_condensacion — Salida del Túnel — familias: []
  - demo-pc-6: detector_metales — Salida del Túnel — familias: []
  - demo-pc-7: fechado_envase — Salida del Túnel — familias: []
  - demo-pc-8: produccion_diaria — Salida del Túnel — familias: []
  - demo-pc-9: inspeccion_visual — Línea 1 (demo-linea-2)

> **[CORTE — contenido no recuperado a partir de aquí. Ver nota de recuperación arriba.]**
