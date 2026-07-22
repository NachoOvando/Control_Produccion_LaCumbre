# Decisiones de arquitectura — Plataforma Industrial La Cumbre

## Contexto

La Cumbre es una empresa de manufactura alimenticia (copacker Arcor + marca propia + fasón para otras marcas). Esta plataforma digitaliza operaciones industriales con foco en trazabilidad, calidad de datos y extensibilidad a largo plazo.

---

## ADR-001: Patrón JSONB + JSON Schema para puntos de control

**Contexto:** Los "puntos de control" de calidad (qué se mide, con qué campos, con qué rangos) son numerosos y cambian con frecuencia. Opciones consideradas:

1. **Una tabla por punto de control** (ej: `registros_peso_relleno`, `registros_defectos_conformado`)
2. **EAV puro** (entidad-atributo-valor)
3. **JSONB con JSON Schema**

**Decisión:** JSONB con JSON Schema.

**Razonamiento:**
- La opción 1 requiere una migración y código nuevo por cada punto de control nuevo. Con decenas de puntos de control, esto se vuelve inmanejable.
- EAV puro pierde tipos (todo es string) y no permite validación declarativa.
- JSONB con JSON Schema preserva tipos, permite validación AJV en runtime, y centraliza la "configuración" del punto de control en una fila de la tabla `puntos_control`.

**Consecuencia:** Power BI no puede leer JSONB nativamente → resuelto con vistas SQL generadas automáticamente por `generate-views.ts`.

---

## ADR-002: Vistas SQL generadas programáticamente

**Contexto:** El JSONB resuelve la ingesta pero complica la lectura analítica.

**Decisión:** Script que lee `schema_json` y genera DDL de vistas que "aplanan" el JSONB a columnas reales.

**Razonamiento:**
- Las vistas escritas a mano requieren un desarrollador por cada punto de control nuevo → exactamente el acoplamiento que ADR-001 buscaba evitar.
- El generador programático permite que el operador del sistema agregue puntos de control sin intervención de un desarrollador.

---

## ADR-003: API versionada desde el inicio

**Contexto:** En el futuro se integrarán balanzas industriales y sensores IoT que consumirán la API.

**Decisión:** Versionar la API en `/api/v1/...` desde el primer día.

**Razonamiento:** Cuando el contrato de una API se rompe después de que hay hardware integrado, actualizar el firmware de las balanzas requiere parada de línea. Al versionar desde el inicio, `/api/v2` puede existir en paralelo mientras `/api/v1` sigue funcionando.

---

## ADR-004: Líneas productivas como entidad genérica compartida por módulos

**Contexto:** Producción y Depósito también necesitarán navegar por "líneas productivas" y posiblemente "puntos de control" propios.

**Decisión:** `lineas_productivas` y `puntos_control_lineas` son genéricas desde el inicio (campo `modulo` para filtrar, no separación en tablas).

**Razonamiento:** Si Producción tuviera su propia tabla de líneas, al agregar el módulo se necesitaría una migración y duplicación de datos. Con la estructura actual, Producción solo necesita filtrar por `modulo = 'produccion'`.

---

## ADR-005: responsableId como UUID en lugar de texto libre

**Contexto:** El formulario analógico tenía "responsable" como campo de texto libre.

**Decisión:** `responsable_id` es FK a la tabla `usuarios`. El texto libre se mantiene solo en el campo `notas` de cada muestra.

**Razonamiento:** Tener el responsable como FK permite análisis por operador (tasa de defectos por persona, auditoría de quién cargó cada dato). El texto libre no permite agregaciones confiables.

**Nota de implementación actual:** NextAuth está activo. Todos los endpoints POST de calidad (`/api/v1/calidad/registros` y `/api/v1/calidad/registros/batch`) inyectan `responsableId` server-side desde `session.user.id` — el cliente nunca lo envía ni puede suplantarlo. El mismo criterio se aplica en `POST /api/v1/calidad/lotes` para `creadoPorId` (ver ADR-011) y en la activación de producto por línea para `activadoPorId` (ver ADR-012).

---

## ADR-006: Correlativos diarios (pallet, nro. de muestra) — derivación en cliente hoy, secuencia server-side como diseño objetivo

**Contexto:** Producción Diaria numera pallets correlativos por línea y por día; otros formularios numeran muestras. Un correlativo duplicado en pallets compromete la trazabilidad (es la clave de cruce ante un recall).

**Estado actual (implementado):** el cliente consulta `GET /api/v1/calidad/registros?puntoControlId&lineaProductivaId(&fecha)` (registros del día) y deriva el próximo correlativo del máximo observado. Aceptable **solo** porque hay una tablet por línea — no hay concurrencia real de escritores sobre la misma secuencia.

**Diseño objetivo (aprobado por arquitecto-industrial, PENDIENTE de implementación):**
- Tabla `secuencias_diarias` (`linea_productiva_id`, `fecha`, `tipo`, `ultimo_valor`) con incremento atómico `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` dentro de la misma transacción que guarda el registro.
- Índice único funcional de defensa: `(linea_productiva_id, fecha, (data->>'pallet_numero')) WHERE deleted_at IS NULL`.
- El POST dejará de aceptar `pallet_numero` / `nroMuestra` del cliente: los asigna el servidor.

**Disparador para implementarlo:** segunda tablet por línea, ingesta desde balanzas/sensores, o cualquier otro escritor concurrente.

**Nota:** el número de lote (`Lote.numeroLote`, ver ADR-011 y ADR-013) es un correlativo distinto, con su propio mecanismo (generación + reintento ante colisión, no secuencia atómica) — no confundir ambos diseños.

**Resuelto (2026-07-20) — Auditoría `AUDIT_PLAN.md`, Lote 2 (C5, C6, B1):**

- **Tabla `SecuenciaDiaria` (`secuencias_diarias`)**, PK compuesta `(lineaProductivaId, fecha, tipo)` + `ultimoValor Int`. `tipo` es el `puntoControlId` (como string), no un enum fijo: dos puntos de control en la misma línea (ej. `temperatura_condensacion` y `temperatura_tanques`) necesitan secuencias independientes, igual que ya exige `registro_unico`. Migración `prisma/migrations/20260720174244_secuencias_diarias_correlativos/`.
- **Índice único funcional de defensa**, agregado a mano en el SQL de la migración (Prisma no soporta índices funcionales en el DSL): `CREATE UNIQUE INDEX registros_calidad_pallet_unico ON registros_calidad (linea_productiva_id, fecha, (data->>'pallet_numero')) WHERE deleted_at IS NULL;`.
- **`siguienteValorSecuencia(tx, ...)`** (`src/db/calidad.repository.ts`) hace el incremento atómico vía `INSERT ... ON CONFLICT ... DO UPDATE ultimo_valor = ultimo_valor + 1 RETURNING ultimo_valor`, dentro de la MISMA transacción interactiva (`prisma.$transaction(async tx => ...)`) que persiste el registro — reemplaza el `$transaction(ops[])` de array plano que usaba antes `createRegistrosBatchDB`.
- **`createRegistroCalidad` y `createRegistrosBatchDB` dejan de confiar en `input.nroMuestra` como valor final.** Decisión explícita para no tocar los 8 formularios de captura: el `nroMuestra` que sigue mandando el cliente se usa únicamente como **clave de agrupación dentro del mismo batch** — filas con igual `(lineaProductivaId, puntoControlId, fecha, nroMuestra-enviado)` comparten un mismo pallet/muestra y reciben UN solo valor asignado atómicamente (soporta `DefectosConformadoForm`: 12 filas de una misma muestra comparten `nroMuestra` y difieren en `filaProd`). Si `data` trae la clave `pallet_numero` (Producción Diaria), se sincroniza con el valor real asignado — son el mismo concepto de negocio.
- **Efecto colateral sobre B1 (`DefectosConformadoForm` no protegía un segundo guardado el mismo día):** queda resuelto por el mismo mecanismo, sin cambios en el componente. Como la secuencia persiste en la tabla entre requests, un segundo guardado el mismo día continúa desde el `ultimoValor` ya alcanzado — no puede colisionar con el primero, sin necesidad de bloquear la UI ni consultar registros previos desde el cliente. Queda abierta, como decisión de producto (no de integridad de datos), si reenviar la jornada completa dos veces debería estar permitido como flujo — hoy simplemente no rompe nada si ocurre.
- **Hallazgo no anticipado por el audit, que refuerza el diseño:** `registro_unico` es `@@unique([puntoControlId, loteId, fecha, nroMuestra, filaProd])` con `filaProd` nullable. Postgres trata cada `NULL` como distinto de cualquier otro `NULL` para unicidad — para los 6 de 8 puntos de control que no usan `filaProd`, esa constraint **no protegía nada** contra un `nroMuestra` duplicado. La secuencia atómica es hoy la única protección real para esos casos, no una capa "extra" como sugería la redacción original de este ADR.
- **C6 — conflicto de `registro_unico` ya no es un `ERROR_INTERNO`/500 genérico.** Nueva función `esColisionRegistroUnico(e)` en el repository (mismo patrón que `esColisionNumeroLote`/`esColisionLoteLinea`), usada en `registro.service.ts` (`createRegistroService` y `createRegistrosBatchService`) para devolver `CONFLICTO_CORRELATIVO` con mensaje accionable; ambos endpoints (`POST /api/v1/calidad/registros` y `.../registros/batch`) mapean ese código a `409` en vez de `400`.
- **Tests de regresión:** `src/db/calidad.repository.secuencias.test.ts` (asignación por grupo, sincronización de `pallet_numero`, continuidad de la secuencia entre dos batches del mismo día) y `src/services/calidad/registro.service.test.ts` (mapeo `CONFLICTO_CORRELATIVO` vs `ERROR_INTERNO`), con Prisma mockeado — mismo criterio que el resto del repo (sin DB real). 76 tests en la suite (63 previos + 13 nuevos), typecheck limpio.
- **Migración generada pero NO aplicada por el agente** — ver `docs/deployment.md`/instrucción de aplicación en el mensaje de cierre de esta tarea: correr `npx prisma migrate deploy` (o `db:migrate` en un entorno de desarrollo) antes de habilitar este flujo en producción.

---

## ADR-007: Modo demo con flag explícito (DEMO_MODE)

**Contexto:** Se necesita poder demostrar y desarrollar la app sin base de datos, sin que ese comportamiento se filtre a producción (en calidad HACCP, "DB caída" ≠ "día sin registros").

**Decisión:** flag de entorno explícito `DEMO_MODE`.
- **Usuario demo** en `src/lib/auth.ts`: existe solo si `NODE_ENV !== "production"` **y** `DEMO_MODE === "true"` **y** las credenciales vienen de `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD` (env vars, nunca hardcodeadas).
- **GET de registros del día:** un error de DB solo se degrada a `{ data: [] }` si `DEMO_MODE=true`; en cualquier otro caso responde `503 DB_NO_DISPONIBLE`.

**Fix (2026-07-15) — el login demo dejó de inventar un usuario fantasma cuando hay DB disponible.** Bug encontrado por el usuario: con DB real ya conectada, el branch demo devolvía un usuario con `id: "00000000-0000-0000-0000-000000000001"` que **no existe en `usuarios`** — cualquier escritura con FK a `usuarios` (activación de línea, alta de lote, registros de calidad) fallaba con `500`/P2003 para toda sesión demo. Ahora, con credenciales demo válidas:
1. Resuelve el usuario real por `DEMO_USER_EMAIL` (no por el email que tipeó el usuario — la contraseña demo nunca sirve para impersonar a otro).
2. Si la DB respondió: el usuario real manda — activo → sesión con su `id`/`rol` reales; inactivo o inexistente → `return null` (rechaza el login; el fantasma **no** es una vía para sortear una desactivación real, hallazgo `seguridad-analista` M-1).
3. Solo si la DB es inalcanzable (catch) cae al fantasma original — preserva el propósito original: navegar sin DB, donde no hay escrituras posibles de todos modos.
4. `console.warn` en cada login por el path demo, para que quede visible en logs qué camino se usó.

Aprobado por `seguridad-analista` con observaciones (sin veto): el gate `NODE_ENV`/`DEMO_MODE` queda intacto y sin impersonación arbitraria; se señaló que `DEMO_USER_PASSWORD` es de facto una segunda contraseña del usuario real y debe ser un valor random fuerte, no uno predecible (`.env.example` actualizado: `DEMO_MODE` default `"false"` + comentario). El guard de boot ("abortar si `NODE_ENV=production` y `DEMO_MODE=true`", ya pendiente antes de este fix) sube de prioridad — antes el fantasma no podía escribir nada, ahora el path demo resuelve a un admin real con escrituras válidas.

**Resuelto (2026-07-20) — Auditoría `AUDIT_PLAN.md`, Lote 1 (C1, C2, C3, C8):** los tres `catch → datos demo` embebidos en pages quedaron gateados por `DEMO_MODE`, con el mismo criterio que el GET de registros del día. Eran, correctamente, **tres** instancias (no dos — ver C8: esta ADR solo nombraba `[lineaId]/[puntoControlId]/page.tsx` y `lotes/nuevo/page.tsx`, faltaba `puntos-control/page.tsx`, la pantalla de entrada al módulo y la más visitada de las tres):
- `src/app/calidad/puntos-control/page.tsx` (C1): el catch ya no atrapaba cualquier error sin gate; ahora solo cae a `LINEAS_DEMO`/`DEMO_PRODUCTOS` si `DEMO_MODE === "true"`, y `0 líneas activas` se trata como estado vacío legítimo (no dispara demo) porque `CalidadModuloView` ya sabe renderizar ese caso.
- `src/app/calidad/lotes/nuevo/page.tsx` (C2): mismo fix, gateado por `DEMO_MODE`.
- `src/app/calidad/[lineaId]/[puntoControlId]/page.tsx` (C3): se mantiene el resguardo existente (solo cae a `DEMO_RELACIONES` si hay match para el `puntoControlId`) y además ahora exige `DEMO_MODE === "true"` — antes de este fix bastaba el match, sin el gate.

En todos los casos, sin `DEMO_MODE=true` el error propaga y lo captura el error boundary del módulo (`src/app/calidad/error.tsx`), en vez de responder 200 con datos ficticios.

**PENDIENTE:**
- Banner de UI "datos de demostración" cuando `DEMO_MODE=true`.

---

## ADR-008: Cálculo de peso del baño por restas apareadas

**Contexto:** El peso del baño no se pesa directo: se infiere de alfajores con y sin baño.

**Decisión (aprobada por scm-alimentos):** peso del baño = promedio de restas apareadas `P_i c/baño − P_i s/baño`, tomando la última muestra sin baño y la última con baño de la jornada. Se eliminó "solo baño" como tipo de producto.

**Nota (ver ADR-016):** este cálculo por restas apareadas es el diseño para **Alfajor Negro** ("Control Peso Baño Alfajor", agregación `derivado`, se evalúa al cierre de jornada). **TAPAS tiene un punto de control propio ("Control Peso Tapas") con un cálculo por resta APAREADA POR OBSERVACIÓN** (no de cierre de jornada): cada una de las 12 observaciones trae su propia resta `con_baño[i] − sin_bañar[i]`, calculada en el cliente. Son dos diseños distintos para dos puntos de control distintos — no confundir.

---

## ADR-009: Autorización de lectura de registros — pendiente de decisión

**Contexto:** hoy cualquier sesión válida lee registros de **todas** las líneas. Todos los usuarios son internos, así que es aceptable.

**Decisión pendiente (hallazgo Medio de seguridad-analista, explícitamente no resuelto):** antes de dar acceso a clientes de fasón o auditores externos hay que definir autorización por línea / por cliente. No implementar acceso externo hasta cerrar esta decisión.

---

## ADR-010: Rediseño del maestro de productos (Marca, Familia, Producto)

**Contexto:** El maestro de productos original modelaba la línea de negocio (marca propia / copacker Arcor / fasón) y la línea de producto como enums directos sobre `Producto` (`LineaProducto`, `TipoCliente`), y no reflejaba la estructura real del maestro de Excel de la planta (hoja "BD", 104 productos, "Descripción Nueva (Std)" como identificador operativo real). Ningún código en `src/` consumía esos enums — quedaron sin uso desde su creación.

**Aprobado por:** `arquitecto-industrial`, `backend-senior`, `frontend-ux`, `seguridad-analista` (sin veto).

**Decisiones:**

1. **La línea de negocio vive en `Marca`, no en `Producto`.** Nuevo enum `LineaNegocio { marca_propia, copacker_arcor, fason_terceros }` en el modelo `Marca`. Razonamiento: es la marca (dueño comercial del producto) la que define si algo es marca propia, copacker o fasón — no el producto en sí. Modelarlo en `Producto` mezclaba un atributo de la relación comercial con un atributo físico del ítem, y obligaba a repetirlo por cada variante de la misma marca.
2. **`Familia` es tabla, no enum.** Crece con el catálogo (nuevas familias aparecen sin tocar código) y es referenciada por puntos de control vía la tabla puente `PuntoControlFamilia` (`puntos_control_familias`), que reemplaza el hardcodeo de familias que vivía en el frontend. Mismo patrón ya usado en `puntos_control_lineas`.
3. **`sku` es `String? @unique` en vez de generar un código provisorio.** 34 de los 104 productos del maestro real no tienen código asignado. Generar un código sintético ("SKU-PROVISORIO-001") sería un dato falso circulando en trazabilidad de exportación (Arcor) — peor que un `null` explícito que la UI puede mostrar como "sin código".
4. **`nombre` (unique) es la descripción estándar completa** ("Familia; Gusto; Marca; Peso; Unid/caja"), tal cual figura en el maestro real, y es la clave de upsert del import — es el identificador operativo real, no un ID interno.
5. **Filtro de familia en el WHERE de `getLotesActivos`, no en JS post-paginación.** Bug corregido durante la revisión: `getLotesActivos` pagina con `take: 100`; filtrar por familia después de traer esa página podía dejar familias enteras fuera del selector de lotes si había más de 100 lotes activos de otras familias. El filtro ahora es parte del `where` de Prisma (`src/db/calidad.repository.ts`).
6. **Nuevos índices** (evitan escaneo de tabla completa a medida que crece el volumen):
   - `Lote`: `[estado, fechaProduccion]` — cubre el `where estado + order by fechaProduccion` de `getLotesActivos`.
   - `Producto`: `familiaId`, `marcaId`, `lineaProductivaId` — cubren los `include` usados en listados y en el import.
7. **`LineaProductiva.codigo Int? @unique`** mapea las líneas 0-3 del Excel del maestro. 0/1/2 son líneas nuevas que crea el import; 3 se resuelve contra la línea ya existente "Línea 3 — Conformado Alfajores" (no se crea una línea nueva para no duplicar la que ya tiene puntos de control asociados).
8. **`src/app/calidad/error.tsx`:** nuevo error boundary del módulo Calidad. Nunca interpola `error.message` en el mensaje al usuario — un operario de planta no debería ver un stack trace ni un mensaje crudo de Prisma/Postgres. Muestra un mensaje genérico + botón "Reintentar".

**Campos nuevos en `Producto`** (ver diccionario de datos completo más abajo): `gusto`, `pesoGramos`, `unidadesPorCaja` (Decimal — semielaborados como TAPAS traen valores no enteros, ej. 751,87), `rendimientoTeorico` + `unidadRendimiento` (enum `unidades_hora` | `cajas_amasijo`), `cajasPorPallet`, `pesoMasaCrudaG`, `esSemielaborado`, `observaciones`, `descripcionVieja` (referencia a la descripción del maestro origen, legacy), `updatedAt`. Se conservan `vidaUtilMeses` y `nomenclaturaLote` del diseño anterior.

**Eliminado:** `enum LineaProducto` y `enum TipoCliente` sobre `Producto` — sin consumidores en `src/`.

---

## ADR-011: Alta de Lote manual — `Lote.numeroLote` vs `Producto.nomenclaturaLote`, y auditoría de autoría

**Contexto:** Antes de esta feature, los registros de `Lote` solo se creaban vía seed o el script de import — no había forma de dar de alta un lote real de producción desde la aplicación. Se construyó la pantalla `/calidad/lotes/nuevo` (Server Component `src/app/calidad/lotes/nuevo/page.tsx` + Client Component `src/components/calidad/AltaLoteForm.tsx`) para cubrir ese hueco.

**Aprobado por:** `arquitecto-industrial` → `backend-senior` → `frontend-ux` → `seguridad-analista` (observaciones resueltas o aceptadas como deuda conocida, ver más abajo).

**Flujo:** Server Component (`page.tsx`, trae los productos activos y valida el rol antes de renderizar el form) → Client Component (`AltaLoteForm.tsx`) → `POST /api/v1/calidad/lotes` (`src/app/api/v1/calidad/lotes/route.ts`) → Service (`src/services/calidad/lote.service.ts`, valida con Zod y chequea que el producto exista y esté activo) → Repository (`src/db/calidad.repository.ts`, función `crearLote`) → Prisma → Postgres/Supabase.

**Actualización (ver ADR-012):** la ruta `/calidad/lotes/nuevo` y el endpoint `POST /api/v1/calidad/lotes` siguen existiendo y funcionando exactamente como se describe acá, pero **se retiraron de la navegación principal** — dejaron de ser el flujo habitual para poner en marcha una línea. Hoy son un building block interno / back-office residual (alta administrativa de un lote sin pasar por el flujo de activación de línea). El flujo de uso diario para "qué se está produciendo" es el de ADR-012.

### Dos números de lote distintos — no intercambiables

El sistema tiene **dos conceptos de "número de lote" con propósitos distintos**, que conviven en el modelo de datos y no hay que confundir ni reutilizar el formato de uno para el otro:

- **`Lote.numeroLote`** (esta feature): identifica la **corrida de producción en curso**. **Actualización 2026-07-20 (ver ADR-013): ya tiene un formato definitivo** (`L-DD/MM/AAAA-AJJJ-hh:mm-ENV`) para el flujo automático de "producto activo por línea" (ADR-012). El formato descrito originalmente acá, `GEN-{yyyyMMdd}-{HHmmss}` (generado por `generarNumeroLoteGenerico()` en `src/db/calidad.repository.ts`), **sigue siendo el que se usa**, pero ya no es un placeholder a resolver — quedó acotado, por decisión explícita del usuario, al alta MANUAL de lote (`/calidad/lotes/nuevo`), que hoy no asocia línea productiva. Ver ADR-013 para el detalle completo.
- **`Producto.nomenclaturaLote`** — **dado de baja de la UI el 2026-07-20** (decisión del usuario, confirmada en dos pasadas — ver hito de esa fecha en `LOG_CONTEXTO.md`): el template por producto (`L{yyyyMMdd}-{correlativo}`) generaba un código propio por pallet, mal calculado y conceptualmente redundante. Se eliminó `generarLotePT()` (`lote-pt.ts`, sin otros consumidores) y sus tests. **`Producto.nomenclaturaLote` se mantiene en el schema y en el maestro importado** (no ameritaba una migración) pero queda sin consumidor en `src/` — dato dormido.
- **El campo "Lote PT" de "Producción Diaria" ya NO es un concepto independiente en la práctica**: **Actualización 2026-07-21 (ver ADR-016):** volvió a ser **editable** — muestra por defecto (sugerido) el `Lote.numeroLote` del producto activo de la línea, con override manual persistido en `sessionStorage` y un botón "Usar sugerido" para volver al valor por defecto. (Entre el 2026-07-20 y el 2026-07-21 fue de solo lectura sin input — ver hito de esa fecha en `LOG_CONTEXTO.md` — el relevamiento de planillas físicas de TAPAS mostró que hacía falta declarar un lote distinto en casos puntuales, así que se reabrió la edición sin volver al 100% manual de la primera pasada). La distinción conceptual de este ADR ("dos números de lote, no intercambiables") sigue siendo válida en el modelo de datos (dos campos distintos, `Lote.numeroLote` vs `Producto.nomenclaturaLote`), pero en el flujo real de captura hoy solo se usa `numeroLote` (sugerido o editado) — `nomenclaturaLote` no participa de ningún dato que se guarde.

### Autorización

Restringido a roles con responsabilidad de supervisión — dar de alta un lote define qué se está produciendo y es la base de toda la trazabilidad posterior, no una tarea de captura de piso de planta:

- **Permitidos:** `admin`, `jefe_planta`, `supervisor_calidad` (constante `ROLES_SUPERVISION_CALIDAD` en `src/lib/auth/roles.ts`, compartida entre la page y el endpoint para que no diverjan).
- **No permitido:** `operador_calidad` (y cualquier otro rol fuera del set anterior) — `403 ROL_INSUFICIENTE`.

**Nota (ver ADR-012):** este gate de rol es específico del alta administrativa. La activación de producto por línea (el flujo de uso diario desde ADR-012) es una decisión de diseño distinta y **no** requiere rol de supervisión — no son inconsistentes entre sí, son dos acciones con distinto significado de negocio (ver razonamiento en ADR-012).

### Concurrencia y generación de `numeroLote`

`crearLote()` genera el número, intenta el `insert`, y ante colisión (`P2002` sobre la columna `numero_lote`) reintenta hasta 3 veces agregando un sufijo de desambiguación. Se aceptó este mecanismo (en vez de la secuencia atómica de ADR-006) porque tanto el alta manual como la activación de producto por línea son acciones de baja frecuencia relativa — no un escritor de alta concurrencia.

**Reutilizado en ADR-012 y ADR-013:** `crearLote()` es la misma función que usa el find-or-create de "producto activo por línea", tanto para el formato legacy como para el formato definitivo — no se duplicó el mecanismo de generación/reintento.

### Auditoría de autoría — `Lote.creadoPorId`

`Lote` ganó el campo `creadoPorId` (FK nullable a `Usuario`, `onDelete: SetNull`, migración `prisma/migrations/20260713184453_add_lote_creado_por/`) — decisión de `arquitecto-industrial` para resolver un gap de auditoría: antes era imposible saber quién dio de alta un lote. Es **nullable** porque a futuro puede haber lotes generados automáticamente (por una Orden de Producción — módulo aún no construido, ver `OrdenProduccion` en el schema) o importados en bulk, sin un usuario humano detrás.

**Riesgo residual señalado por `seguridad-analista` (severidad Alta, no bloqueante hoy):** si en algún momento se implementa borrado **físico** de `Usuario`, el `onDelete: SetNull` blanquea la autoría del lote sin dejar rastro alternativo de quién lo creó. Se verificó que **hoy no existe ningún `usuario.delete()` físico** en el código — el borrado de usuarios es lógico, vía el campo `activo` — así que el riesgo es teórico por ahora. **Nota de vigilancia:** si en el futuro se agrega borrado físico de `Usuario`, hay que revisar este `onDelete` antes de habilitarlo (opciones: agregar un log de auditoría append-only tipo `AuditoriaRegistro` para el alta de lote, o cambiar a `Restrict`).

### Deuda técnica conocida de esta feature (aceptada, no bloqueante)

- **Colisión de timestamp bajo alta concurrencia** en `GEN-{yyyyMMdd}-{HHmmss}` — ver "Concurrencia" arriba. Sigue vigente porque el formato legacy sigue en uso para el alta manual (ver ADR-013).
- **Sin rate limiting** en `POST /api/v1/calidad/lotes` (señalado por `seguridad-analista`, severidad Media) — es la misma deuda transversal ya señalada para `authorize()` de NextAuth (ver sección "Deuda técnica y decisiones pendientes"), no algo específico de esta feature.
- **Cero tests automatizados** — mismo criterio que el resto del repo: no hay infraestructura de testing configurada todavía (ver esa misma sección).
- **Fallback demo sin gatear por `DEMO_MODE`** en `src/app/calidad/lotes/nuevo/page.tsx` — ver ADR-007.

---

## ADR-012: Producto activo por línea — reemplazo del `<select>` repetido en los 8 formularios de calidad

**Contexto:** Cada uno de los 8 formularios de captura de calidad tenía su propio `<select>` "Producto en producción", con estado local (`loteId`/`loteTocado`) y una preselección heurística basada en el último `RegistroCalidad` del día (`getLoteEnCursoDeLinea`, en `src/db/calidad.repository.ts`). Cada operario, en cada formulario, volvía a elegir el producto — riesgo de inconsistencia entre formularios de la misma línea el mismo turno, y lógica repetida 8 veces.

**Aprobado por:** `arquitecto-industrial` → `backend-senior` → `frontend-ux` → `seguridad-analista` (observaciones resueltas, ver más abajo).

**Decisión:** la pregunta "¿qué se está produciendo en esta línea?" se hace **una sola vez por línea** (no por formulario), se persiste server-side, y todos los formularios de esa línea la leen del mismo lugar. Nuevo flujo: **Ingreso a la línea → Ingreso/activación de producto (el lote se genera o reutiliza automáticamente) → grilla de puntos de control.**

**Se retiró `getLoteEnCursoDeLinea`** del repository. Reemplazo documentado explícitamente porque, si alguien busca esa función, tiene que encontrar por qué ya no existe: la heurística vieja infería el lote en curso mirando el último registro de calidad cargado ese día (frágil — dependía de que ya hubiera al menos un registro, y podía arrastrar un producto viejo si el operario tardaba en cargar el primer punto de control). El reemplazo (`getProductoActivoDeLinea`) lee un puntero explícito y persistido (`LineaProduccionEstado`), no infiere nada.

### Modelo de datos — tres piezas nuevas

1. **`Lote.lineaProductivaId`** (`String? @db.Uuid`, FK opcional a `LineaProductiva`) + **`@@unique([productoId, lineaProductivaId, fechaProduccion])`** en `prisma/schema.prisma`. Habilita un **find-or-create**: activar el mismo producto en la misma línea el mismo día reutiliza el lote existente en vez de crear uno nuevo (`activarProductoLinea` en `src/db/calidad.repository.ts` hace `findUnique` por ese unique compuesto antes de `crearLote`). Verificado manualmente en browser contra Supabase real: activar Alfajor → lote A; activar Tapas → lote B; reactivar Alfajor → mismo lote A (no un lote C). `lineaProductivaId` es nullable porque coexiste con lotes históricos sin línea (altas previas a esta feature) y con futuros lotes generados desde `OrdenProduccion`. **Actualización ADR-013:** el "día" de este find-or-create ya no es el día calendario — ver "jornada productiva" en ADR-013.
2. **`LineaProduccionEstado`** (`linea_produccion_estado`, tabla nueva, puntero mutable): PK `lineaProductivaId`, `loteActivoId` (`String @unique @db.Uuid`, FK a `Lote`), `activadoPorId` (FK a `Usuario`), `activadoEn` (`DateTime`). Es la fuente de verdad que leen los 8 formularios vía `getProductoActivoDeLinea(lineaProductivaId, fecha)`. Si la `fechaProduccion` del lote apuntado no coincide con la fecha consultada (hoy en planta), se trata como "sin producto activo" — **no arrastra el producto de ayer** a la mañana siguiente.
3. **`LineaActivacionLog`** (`linea_activacion_log`, tabla nueva, **append-only**): `id`, `lineaProductivaId`, `loteId`, `usuarioId`, `createdAt` (con índice `[lineaProductivaId, createdAt]`). Historial inmutable de cada activación — mismo patrón que `LoteEstadoLog`/`AuditoriaRegistro` ya existentes en el repo. **Nunca se hace `update`/`delete` sobre esta tabla** (confirmado por `seguridad-analista` con búsqueda en todo el repo). Sirve doble propósito: trazabilidad de "quién activó qué, cuándo" y fuente de datos del guard anti-abuso (ver más abajo).

**Migración:** `prisma/migrations/20260714120000_linea_producto_activo/migration.sql`.

**Reglas de integridad relevantes:**
- `lotes_producto_id_linea_productiva_id_fecha_produccion_key` (unique compuesto) es lo que hace posible el find-or-create sin condición de carrera lógica — dos requests que intentan activar el mismo producto/línea/día chocan contra este índice si ambos intentan `crearLote` a la vez; el segundo recibe una colisión Prisma (`P2002`) que el repository interpreta como "el otro request ya ganó la carrera" y reutiliza el lote resultante en vez de fallar con 500 (ver `activarProductoLinea`).
- `linea_produccion_estado_lote_activo_id_key` (unique en `loteActivoId`): un lote no puede ser el "activo" de más de una línea a la vez.
- Todas las FK de las dos tablas nuevas hacia `usuarios`/`lineas_productivas`/`lotes` son `ON DELETE RESTRICT` (no `SetNull` ni `Cascade`) — a diferencia de `Lote.creadoPorId` (ADR-011), acá no se aceptó blanquear la trazabilidad ante un borrado; un intento de borrar algo referenciado falla en vez de silenciarse.

### Autorización — decisión consciente, no un gap

El endpoint de activación (`POST /api/v1/lineas-productivas/[lineaId]/producto-activo`) **no requiere rol de supervisión**, a diferencia de `POST /api/v1/calidad/lotes` (alta administrativa, ver ADR-011), que sigue gateada a `admin` / `jefe_planta` / `supervisor_calidad`, sin tocar. Cualquier usuario con sesión válida puede activar o cambiar el producto de su línea.

**Razonamiento (decisión de `arquitecto-industrial`):** activar un producto es una **declaración operativa** — "esto es lo que se está fabricando ahora" — no un **veredicto de calidad** (aprobar, rechazar o poner en cuarentena un lote, que sí requiere rol elevado porque tiene consecuencias regulatorias/de exportación). La trazabilidad de "quién" no se resuelve con un gate de rol sino con `activadoPorId` + `LineaActivacionLog` (append-only): siempre se sabe quién activó qué, sin necesidad de restringir quién puede hacerlo.

Esto es **intencional y no una inconsistencia** con el gate de rol de ADR-011 — son dos acciones de negocio distintas. Si `seguridad-analista` en una auditoría de matriz de roles reporta esto como "inconsistente" sin ver este razonamiento, corresponde señalarle esta nota, no ajustar el código.

### Guard anti-abuso (rate limiting puntual, no transversal)

`verificarLimiteActivaciones()` en `src/services/calidad/linea-producto-activo.service.ts` — consulta `LineaActivacionLog` en cada request (sin caché ni estado en memoria de proceso; stateless, mismo patrón que el resto del repo):

- **Cooldown:** `429 ACTIVACION_MUY_FRECUENTE` si el mismo usuario activó algo en la misma línea hace menos de **30 segundos**.
- **Ventana:** `429 LIMITE_ACTIVACIONES_EXCEDIDO` si el mismo usuario acumuló **5 o más** activaciones en la misma línea en los últimos **10 minutos**.
- La respuesta incluye header `Retry-After` (segundos). Verificado en browser: dos POST consecutivos devuelven `201` y luego `429`.

**Por qué es puntual y no la solución al rate limiting transversal pendiente** (ver "Deuda técnica y decisiones pendientes" más abajo, y ADR-011): activar producto mueve un puntero de estado (`LineaProduccionEstado`) del que dependen en tiempo real los 8 formularios y la generación de lotes — un abuso acá corrompe trazabilidad de producción, no es un caso genérico de "alguien manda muchos requests". El resto de endpoints de escritura del repo sigue sin rate limiting.

### Contrato de datos — `ProductoActivoLinea`

Tipo en `src/types/calidad.ts`:

```ts
type ProductoActivoLinea = {
  loteId: string;
  numeroLote: string;
  productoId: string;
  productoNombre: string;
  familiaSlug: string;
  vidaUtilMeses: number | null;
  nomenclaturaLote: string | null;
  activadoPorNombre: string;
  activadoEn: string; // ISO
};
```

`vidaUtilMeses` y `nomenclaturaLote` son datos de **maestro del producto** (no de la activación en sí), incluidos a propósito: sin ellos, `ProduccionDiariaForm` perdía la auto-sugerencia de vencimiento de PT y de nomenclatura de lote que ya tenía antes de esta feature. Durante el desarrollo se sacaron por error del tipo en un momento y se detectó la regresión (el formulario dejaba de auto-completar esos campos); se volvieron a agregar. Si en el futuro alguien "limpia" este tipo para dejarlo mínimo, tiene que confirmar que esos dos formularios consumidores siguen recibiendo el dato desde otro lado antes de sacarlos. **Desde ADR-013, `vidaUtilMeses` además es obligatorio para poder activar el producto — ver esa sección.** **Desde ADR-015, el tipo ganó además `cajasPorPallet` y un campo opcional `especificaciones: EspecCampo[]` (specs de calidad vigentes del producto para el punto de control en contexto, solo poblado en la page de captura) — ver ADR-015.**

`familiaSlug` se agregó en una iteración posterior (pedido explícito del usuario: "la familia está incluida en el producto seleccionado") para que el filtrado de la grilla de puntos de control se derive del producto activo en vez de un filtro manual — ver más abajo. Poblado desde `producto.familia.slug` en el `include` de `getProductoActivoDeLinea`/`activarProductoLinea` (`src/db/calidad.repository.ts`) y en los dos mappers que aplanan el estado de Prisma (`route.ts` del endpoint y el mapper inline de `[lineaId]/[puntoControlId]/page.tsx`). **Desde ADR-016, `familiaSlug` también se usa para: (a) ocultar el campo "Peso del alfajor" de `ProduccionDiariaForm` cuando la familia activa no es `alfajor_negro`; (b) filtrar la lista de insumos seleccionables de `TrazabilidadInsumosForm`.**

### UI

- **`src/components/calidad/CalidadModuloView.tsx` — asistente de 4 pasos** (rediseño según vistas modelo del usuario; máquina de estados `paso: "cargando" | "linea" | "producto" | "grilla"`). Solo cambió la presentación respecto al diseño original de este ADR (que usaba tabs de líneas siempre visibles + selector de producto inline sobre la grilla) — el modelo de datos, los endpoints, la autorización y el guard anti-abuso son exactamente los mismos:
  1. **Paso "linea"** — pantalla dedicada "Línea Productiva": card centrada con un `<select>` de líneas y botón "Avanzar". Ya no existen las tabs de líneas. Si el fetch de producto activo de esa línea falla (red inestable en planta), **no se asume silenciosamente "sin producto activo"** — eso arriesgaba que el operario active por error un producto que pisara el que ya estaba activo para toda la línea. En su lugar se muestra un mensaje de error inline con botón "Reintentar" en este mismo paso. Si el operario reconfirma la **misma** línea ya resuelta (por ejemplo, volviendo desde "Cambiar de Línea"), se refetchea igual — no se confía en el estado en memoria del cliente, porque otro operario pudo haber hecho un changeover en esa línea compartida mientras tanto.
  2. **Paso "producto"** — pantalla dedicada "Seleccionar Producto a Fabricar": `<select>` agrupado por familia (`<optgroup>` por `Familia.nombre`) y campo informativo "Número de Lote: Se asigna automáticamente" (el número real lo genera el server al avanzar, con el formato definitivo `L-DD/MM/AAAA-AJJJ-hh:mm-ENV` desde ADR-013 — antes era el placeholder `GEN-...`). **Este paso SIEMPRE se muestra al confirmar una línea desde el flujo de entrada — nunca se saltea, ni siquiera si la línea ya tiene producto activo hoy** (pedido explícito del usuario, revirtiendo el diseño original de este ADR que sí saltaba el paso). Si hay producto activo, viene **preseleccionado** en el `<select>` para que "Avanzar" sea una confirmación explícita, no una elección a ciegas.
     - Si el producto seleccionado **coincide** con el activo, el botón dice **"Confirmar y avanzar"** y NO se hace `POST` (no hay cambio de estado que registrar — evita ensuciar `LineaActivacionLog` con re-confirmaciones y evita chocar con el cooldown del guard).
     - Si el producto seleccionado **difiere**, el botón dice **"Cambiar producto"**, el card "Producto actual" pasa a estilo de advertencia (ámbar) con el texto "Vas a reemplazarlo y generar un lote nuevo para el producto elegido", y sí se hace el `POST .../producto-activo` (con los mismos errores existentes, incluidos los `429` del guard y, desde ADR-013, el `409 PRODUCTO_SIN_VIDA_UTIL`). Esto se agregó tras un hallazgo de `frontend-ux`: antes, confirmar el producto ya activo y cambiarlo a otro se veían visualmente idénticos (mismo botón "Avanzar"), con riesgo de que un mis-tap en el `<select>` disparara un changeover real sin que el operario lo notara.
     - **Única excepción al "siempre preguntar":** la restauración por `?linea=` al volver "atrás" desde un punto de control (ver paso "cargando" más abajo) sigue cayendo directo en la grilla sin pasar por este paso — re-preguntar en cada vuelta de un formulario sería fricción pura, no una salvaguarda real.
     - Si la línea ya tenía producto activo (caso "Cambiar producto" desde la grilla), el botón secundario es "Cancelar" (vuelve a la grilla sin activar nada); si no había producto activo, es "Volver a elegir línea".
  3. **Paso "grilla"** — la grilla de puntos de control, con header de contexto ("Producto en producción — {línea}: {producto} — Lote {n}"), botón "Cambiar de Línea" (→ paso 1) y **botón** "Cambiar producto" (→ paso 2, renombrado desde "Agregar otro producto" tras hallazgo de `frontend-ux`: el label sugería producción en paralelo cuando en realidad reemplaza el producto activo de la línea — no hay soporte de productos simultáneos). Es un botón con padding y target táctil real (`px-4 py-2.5 rounded-xl`, borde rojo), no un link de texto. **Ya no hay chips de filtro por familia** — el filtrado de PCs se deriva automáticamente de `productoActivo.familiaSlug` (la familia ya está incluida en el producto seleccionado, pedido explícito del usuario): PCs sin familia asignada siempre se muestran, PCs con familias solo si incluyen la del producto activo. El `?familia=` como query param desapareció por completo — los hrefs de las cards, el back link del punto de control y el dispatch del modo Tapitas en `PesoMedicionesForm` derivan la familia server-side desde `productoActivo.familiaSlug`. Empty state distingue dos casos: "Sin puntos de control configurados" (la línea no tiene ninguno) vs. "Ningún punto de control aplica a {producto} en esta línea" (hay PCs pero ninguno matchea la familia del producto activo) — antes ambos casos mostraban el mismo mensaje de "contactar al administrador", que era engañoso en el segundo caso. La grilla sigue bloqueada hasta que hay producto activo: sin producto activo no se llega a este paso.
  - **Paso "cargando" (restauración por query param `?linea=`):** al volver desde un punto de control, primero se muestra una pantalla de espera dedicada, sin controles interactivos, mientras se resuelve el fetch de producto activo de esa línea. Se agregó tras revisión de `frontend-ux`: antes, mientras ese fetch estaba en vuelo, se dejaba el `<select>` del paso "linea" habilitado, y una elección del operario en ese momento se podía descartar de golpe cuando el fetch resolvía. Con el fetch resuelto, y solo en este caso de restauración (flag `esRestauracion` en un `useRef`, se apaga tras el primer fetch), cae directo en el paso "grilla" si hay producto activo — si no, cae en el paso "producto" igual que el flujo normal.
  - Verificado end-to-end en browser contra Supabase real, en ambas iteraciones: los 4 pasos, el paso de producto siempre visible con preselección, confirmar sin POST, changeover con aviso ámbar, filtro derivado de familia (con producto Tapas activo se ocultan los PCs exclusivos de Alfajor Negro), restauración por query param sin re-preguntar, sin errores de consola.
- **`src/components/calidad/ProductoActivoBanner.tsx`** (nuevo, compartido por los 8 formularios de punto de control): solo lectura — `{productoNombre} — Lote {numeroLote}`, "Activado por {nombre}", y un botón "Cambiar producto" que navega a `/calidad/puntos-control?linea={lineaId}` (el asistente de línea/producto). Antes de navegar, pide confirmación con `window.confirm` — se agregó tras un hallazgo de `frontend-ux`: el link salía del formulario de captura en curso sin avisar que había datos sin guardar.
- **`/calidad/lotes/nuevo`** (alta administrativa, ADR-011) y su entrada en la navegación principal **se retiraron de la navegación primaria**. La ruta y `POST /api/v1/calidad/lotes` siguen existiendo (confirmado: no hay ninguna referencia a `lotes/nuevo` en `src/components` — el único acceso que queda es la URL directa), como building block interno / back-office residual. No se tocó ni se dio de baja el código.

### Deuda conocida de esta feature (aceptada, no bloqueante)

- **No se valida que `producto.lineaProductivaId` coincida con la línea que se está activando.** Un operario podría, por error de selección en el `<select>` de 104 productos sin filtrar, activar en la línea equivocada un producto que pertenece a otra línea. Preexistía también en el alta administrativa (ADR-011); se agrava acá porque ya no hay gate de rol filtrando quién puede equivocarse. Señalado por `backend-senior`, aceptado como deuda consciente — no bloqueó el cierre de la feature.
- ~~El selector de producto muestra el catálogo completo de 104 productos sin filtrar por línea~~ — **resuelto**: `ProductoOption` (`CalidadModuloView.tsx`) ganó `lineaProductivaId`, poblado en `puntos-control/page.tsx` desde `getProductosActivos()` (el campo ya venía en la query, no fue necesario tocar el repository). El `<select>` del paso "producto" ahora filtra a `p.lineaProductivaId === null || p.lineaProductivaId === lineaActivaId` — solo se ven los productos de esa línea más los que no tienen línea asignada en el maestro (que siguen apareciendo en toda línea, mismo criterio que usaba la vieja `getLotesActivos`). Verificado en browser: Línea 3 muestra 2 productos (Alfajor Negro, Tapas); Línea 0 muestra otro set de 8 (bizcochos, cookies, snacks).
- ~~El label "Agregar otro producto" sugiere producción en paralelo~~ — **resuelto**: renombrado a "Cambiar producto" y el paso "producto" ahora aclara explícitamente el reemplazo (aviso ámbar "Vas a reemplazarlo y generar un lote nuevo") cuando el producto elegido difiere del activo. Sigue sin existir soporte de productos simultáneos por línea — si en el futuro se decide agregarlo de verdad (no solo aclarar el copy), es una regla de negocio y requiere pasar primero por `scm-alimentos`.
- **Estilos de botón primario/secundario y el card centrado (`rounded-2xl`, paleta roja) están duplicados en los 3 pasos interactivos de este componente** — candidato a extraer a componentes compartidos si el patrón se repite en otro módulo.
- **Mensajes de error del server (`json.error`) se muestran tal cual al operario sin mapeo a copy más amigable** — aceptable por ahora, revisar si el backend empieza a devolver mensajes más técnicos.
- **Rate limiting transversal del resto de endpoints de escritura del repo sigue pendiente** — el guard de esta feature es puntual a este endpoint, no una solución general (ver ADR-011 y "Deuda técnica y decisiones pendientes").
- **Sin tests automatizados** para `activarProductoLinea`, `getProductoActivoDeLinea` ni el guard de concurrencia — mismo criterio que el resto del repo (ver esa misma sección). **Actualización ADR-013:** esto ya no es así para las funciones de generación de `numeroLote` ni para `linea-producto-activo.service.ts` — ver esa sección.

---

## ADR-013: Formato definitivo de `Lote.numeroLote` (flujo automático) + "jornada productiva" 6am-6am

**Contexto:** ADR-011 dejó `Lote.numeroLote` con el placeholder `GEN-{yyyyMMdd}-{HHmmss}`, marcado explícitamente como temporal ("las reglas reales de numeración las va a definir el usuario más adelante" — deuda #9 de `docs/auditoria-2026-07.md`). Esta feature cierra esa deuda para el flujo de uso diario (ADR-012, "producto activo por línea"). El alta MANUAL de lote (`/calidad/lotes/nuevo`, ADR-011) sigue con el placeholder — ver "Alcance" abajo.

**Aprobado por:** `scm-alimentos` (regla de negocio: criterio de vencimiento, corte 6am-6am, bloqueo por vida útil) → `arquitecto-industrial` (sincronización lectura/escritura en la ventana 00:00-05:59, riesgo de colisión determinística por minuto) → implementación → `backend-senior` (encontró y corrigió un bug de timezone reproducido también en el camino legacy) → `seguridad-analista` (aprobado; una observación menor ya corregida).

### Formato: `L-DD/MM/AAAA-AJJJ-hh:mm-ENV`

Nuevo módulo puro `src/lib/calidad/lote-numero.ts` (`generarNumeroLote`), sin dependencias de Prisma/framework:

- `DD/MM/AAAA`: fecha de **vencimiento** del producto (`fechaProduccion + Producto.vidaUtilMeses`, vía `calcularFechaVencimiento` en `src/lib/calidad/lote-pt.ts` — preserva el día del mes con clamp de overflow; `calcularVencimiento`, el `MM/yyyy` que ya usaba Producción Diaria, ahora es un wrapper de esta misma función).
- `AJJJ`: último dígito del año + día juliano (1-366) de la fecha de **producción**.
- `hh:mm`: hora de planta (`horaPlanta()`, zona `America/Argentina/Cordoba`) al momento de crear el registro — es **"hora de registro en sistema"**, NO la hora real de inicio de producción (aclaración explícita de `scm-alimentos`, para no sugerir una precisión que el sistema no tiene).
- `ENV`: código de línea productiva (`LineaProductiva.codigo`; valores reales hoy: 0/1/2/3).

Determinístico por minuto: dos lotes de la misma línea en el mismo minuto generan el mismo string base. `crearLote()` (`src/db/calidad.repository.ts`) le agrega un sufijo de desambiguación (`-02`, `-03`) en reintentos ante colisión real de `numero_lote` — no se depende de que el string cambie solo con el paso del tiempo.

### Alcance: solo el flujo automático — el alta manual sigue con el placeholder legacy

Este formato se genera únicamente cuando `crearLote()` recibe `lineaCodigo` (y por lo tanto también `vidaUtilMeses`) — eso ocurre siempre que el lote se crea desde `activarProductoLinea` (ADR-012, "producto activo por línea"). El alta MANUAL de lote (`/calidad/lotes/nuevo`, ADR-011) **no** asocia línea productiva hoy, y sigue generando `GEN-{yyyyMMdd}-{HHmmss}` (`generarNumeroLoteGenerico()`).

No es una deuda accidental: es una decisión explícita del usuario, porque ese camino manual **no ocurre en la práctica** desde que existe "producto activo por línea" (confirmado al cerrar esta feature, ver hito de `LOG_CONTEXTO.md` del 2026-07-20) — sigue existiendo como building block interno/back-office residual (ver ADR-011, "Actualización"). Si en el futuro se decide asociar línea al alta manual también, el mismo `generarNumeroLote()` aplica sin cambios de diseño.

### Bloqueo de negocio: activar un producto sin vida útil cargada

`activarProductoLineaService` (`src/services/calidad/linea-producto-activo.service.ts`) rechaza con **`409 PRODUCTO_SIN_VIDA_UTIL`** si `Producto.vidaUtilMeses` es `null` o `<= 0` — antes se permitía activar igual. Decisión explícita del usuario tras una auditoría de datos: 9/104 productos activos del maestro no tienen ese campo cargado (2 de ellos, TAPAS en Línea 3 y BIZCOCHOS en Línea 0, estaban activos el día de esta decisión — se van a romper en su próximo changeover hasta que se complete el maestro; riesgo aceptado a conciencia, no un bug).

La validación es `<= 0`, no solo `== null` — hallazgo de `seguridad-analista`: un dato mal cargado en el maestro (0 o negativo) debía dar el mismo `409` claro, no delegar en el `throw` defensivo de `calcularFechaVencimiento` y terminar en un `500` genérico.

### "Jornada productiva": corte de 24hs de 6am a 6am — alcance acotado

Nueva función `jornadaProductiva()` (`src/lib/calidad/fecha-planta.ts`, junto a las preexistentes `hoyPlanta()`/`horaPlanta()`): en vez de cortar el día a medianoche, corta a las 6am — antes de esa hora, "hoy" sigue siendo el día calendario anterior. Usa un solo snapshot de fecha+hora vía `formatToParts` para evitar la ventana de milisegundos entre dos `new Date()` separados justo en el borde de medianoche.

**Se usa en exactamente tres lugares — no en todo el módulo:**
- El find-or-create de `activarProductoLinea` (decide si corresponde generar un `Lote` nuevo o reusar el existente).
- La lectura del producto activo desde el endpoint del asistente: `GET /api/v1/lineas-productivas/[lineaId]/producto-activo` (`getProductoActivoDeLinea`).
- La lectura del producto activo desde el Server Component de la grilla de puntos de control: `src/app/calidad/[lineaId]/[puntoControlId]/page.tsx` (mismo `getProductoActivoDeLinea`, agregado al cerrar esta feature — ver nota abajo).

Razón de este alcance acotado (hallazgo de `arquitecto-industrial`): si la escritura usa el corte 6am-6am pero alguna lectura sigue usando el día calendario (`hoyPlanta()`), en la franja 00:00-05:59 esa lectura le diría al operario "sin producto activo" aunque el find-or-create de la escritura sí lo considere vigente — lectura y escritura quedarían desincronizadas justo en el borde más delicado. El resto del módulo (registros del día, correlativo de pallets, resolución de turno) **sigue usando `hoyPlanta()` sin cambios** — decisión explícita para acotar el blast radius del cambio, no para unificar ambos conceptos de "día".

**Inconsistencia encontrada y corregida al documentar esta feature:** `documentador` encontró que `src/app/calidad/[lineaId]/[puntoControlId]/page.tsx` todavía llamaba `getProductoActivoDeLinea(lineaId, hoyPlanta())` — el día calendario, no `jornadaProductiva()` — mientras que el endpoint `GET .../producto-activo` (el que consume el asistente cliente-side) sí usaba `jornadaProductiva()`. Era exactamente el mismo desajuste lectura/escritura que este ADR resuelve, sobreviviendo en un segundo punto de lectura que no se había actualizado en la implementación original. Corregido en el mismo cierre (cambio de una línea, mismo patrón ya aplicado en el endpoint); typecheck + suite completa verdes tras el fix.

### Bug de timezone encontrado y corregido en el camino

`fechaProduccion` llega a `crearLote()` parseada de un string ISO `"yyyy-MM-dd"` (vía `jornadaProductiva()`/`hoyPlanta()` en los callers) — eso la construye en **UTC medianoche**. Pero `calcularFechaVencimiento` y el cálculo de día juliano leen con getters **locales** (mismo criterio que el resto de `lote-pt.ts`). Mezclar ambos corre el día calendario según el desfasaje horario de la máquina que ejecuta el proceso Node.

Se verificó el bug real en browser: un lote con vencimiento mostrado "19/11" pero día juliano "6201" (que corresponde al día 20) — contradictorio entre sí. Afectaba **ambos** caminos, el nuevo y el legacy `GEN-`.

**Fix:** en `crearLote()`, se reconstruye una sola vez `fechaCalendario` con getters UTC hacia un `Date` de constructor local, antes de bifurcar entre el formato nuevo y el legacy. Test de regresión en `src/db/calidad.repository.lote-numero.test.ts` (Prisma mockeado, sin DB real).

**Lección para no repetir** (mismo patrón de fondo ya visto en el hito de `LOG_CONTEXTO.md` del 2026-07-13, con `toISOString()` — ver el comentario al tope de `fecha-planta.ts`): cualquier función que mezcle un `Date` parseado de un string ISO con getters locales corre el riesgo de desalinear el día calendario según la zona horaria de la máquina que ejecuta el proceso. Cuando se combina un `Date` que vino de un string con getters, hay que decidir explícitamente UTC o local para TODO el cálculo — nunca mezclarlos a mitad de camino.

### Cambios de firma

`crearLote()` y `activarProductoLinea()` (`src/db/calidad.repository.ts`) pasaron de parámetros posicionales a un objeto — decisión de `backend-senior`: dos `number | null` consecutivos (`vidaUtilMeses`, `lineaCodigo`) son fáciles de invertir sin que TypeScript lo detecte con parámetros posicionales.

### Verificación

63 tests en la suite (incluye el test de regresión del bug de timezone), typecheck limpio. Verificado en browser contra Supabase real: activación de producto con el formato nuevo, y bloqueo `409 PRODUCTO_SIN_VIDA_UTIL` con un producto sin vida útil cargada en el maestro.

### Deuda técnica conocida de esta feature

- **Inconsistencia lectura/escritura sin resolver** en `src/app/calidad/[lineaId]/[puntoControlId]/page.tsx` — ver "Inconsistencia encontrada al documentar" más arriba.
- El resto de la deuda de ADR-011 y ADR-012 (colisión de timestamp bajo alta concurrencia en el formato legacy, sin rate limiting transversal, fallback demo sin gatear, falta de validación `producto.lineaProductivaId` contra la línea activada) sigue vigente sin cambios — no se tocó en esta feature.

---

## ADR-014: Pool de conexiones acotado para runtime serverless (Vercel) + conexión directa para el CLI

**Contexto:** `AUDIT_PLAN.md` (hallazgo P2, Lote 4) dejó pendiente confirmar la topología de deploy de producción antes de tocar la configuración de conexiones de `src/lib/prisma.ts` — no había evidencia en el repo de si el deploy era un servidor Node persistente o serverless. El usuario confirmó que producción corre en **Vercel** (funciones serverless), lo que cambia la severidad real del hallazgo: cada invocación puede levantar una instancia nueva de `PrismaClient`/pool, y sin un límite explícito de conexiones, un pico de tablets escribiendo en paralelo puede agotar las conexiones disponibles del Postgres de Supabase.

**Decisión: dos connection strings distintas para dos consumidores distintos.**

- **Runtime de la app (`src/lib/prisma.ts`, `DATABASE_URL`):** apunta al **connection pooler de Supabase (PgBouncer, modo transacción, puerto 6543)**, con `?pgbouncer=true`. Es el modo correcto para invocaciones serverless de vida corta: cada función toma una conexión del pool solo durante la transacción y la devuelve, en vez de mantener conexiones directas abiertas por instancia.
- **CLI de Prisma (`prisma.config.ts`, `DIRECT_URL`):** apunta a **conexión directa a Postgres (puerto 5432, sin pooler)**. PgBouncer en modo transacción no soporta las operaciones que `migrate`/`db push`/`studio` necesitan (advisory locks de migración, algunas sentencias DDL) — el CLI corre localmente/en CI, no en el hot path serverless, así que no tiene el problema que el pooler resuelve para el runtime.

**Por qué el adapter actual es compatible con PgBouncer en modo transacción (el bug clásico "Prisma + PgBouncer" no aplica acá):** el bug conocido de Prisma con PgBouncer es específico del motor binario Rust de Prisma (`query engine`), que usa prepared statements con nombre — PgBouncer en modo transacción no garantiza que la misma conexión física sirva dos statements sucesivos de la misma sesión lógica, así que un prepared statement con nombre creado en una conexión puede no existir en la siguiente, rompiendo la query. Este repo usa `@prisma/adapter-pg` (driver `pg` directo, sin motor Rust) **sin** configurar `statementNameGenerator`. Confirmado leyendo `node_modules/@prisma/adapter-pg/dist/index.d.ts`: sin ese callback, el adapter no le asigna nombre a los prepared statements que arma (`name` queda sin definir en la llamada a `pg.Client#query()`), por lo que Postgres los trata como statements **sin nombre** — no se cachean entre conexiones, así que no hay estado de sesión que dependa de qué conexión física del pool sirvió la query anterior. Esto es justamente lo que los hace seguros bajo PgBouncer transaction pooling. **No agregar `statementNameGenerator` sin revisar este ADR primero** — reintroduciría en silencio el bug clásico.

**Pool `max: 1` en el adapter del runtime:** con Vercel, cada invocación de función es efectivamente una instancia de proceso de vida corta. Mantener un pool interno de más de una conexión por instancia no aporta paralelismo real (el pooler de Supabase ya multiplexa muchas conexiones lógicas sobre pocas físicas) y sí puede multiplicar innecesariamente el conteo de conexiones lógicas hacia PgBouncer bajo concurrencia de invocaciones. `max: 1` fuerza a cada instancia de función a usar como máximo una conexión física del pool de `pg` a la vez, delegando el verdadero pooling a PgBouncer. Junto con `idleTimeoutMillis: 10_000` y `connectionTimeoutMillis: 10_000` — para no dejar conexiones ociosas abiertas más de lo necesario en una instancia serverless que puede quedar "congelada" (frozen) entre invocaciones, y para fallar rápido en vez de colgarse si el pooler está saturado.

**Implementación:**
- `src/lib/prisma.ts`: `PrismaPg({ connectionString, max: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 })`, con el comentario de guardia sobre `statementNameGenerator` in situ.
- `prisma.config.ts`: `datasource.url` pasa de `DATABASE_URL` a `DIRECT_URL`.
- `.env.example`: documenta ambas variables y su propósito distinto.

**Acción manual requerida (fuera del alcance de este cambio, no se tocan secretos):** el usuario debe agregar `DIRECT_URL` a `.env.local` (conexión directa Supabase, puerto 5432, sin `?pgbouncer=true`) y confirmar que `DATABASE_URL` ahí ya apunta al pooler (puerto 6543, con `?pgbouncer=true`); y configurar ambas variables en el panel de Vercel (Production y Preview).

**Cierra P2 de `AUDIT_PLAN.md`.**

---

## ADR-015: Administración del maestro + especificaciones de calidad por producto (comparación medido-vs-estándar en vivo)

**Contexto:** hasta ahora el maestro (`Producto`/`Marca`/`Familia`) solo se poblaba vía seed o el script de import, sin UI ni API de escritura (deuda de ADR-010), y las planillas de calidad no tenían forma de declarar el objetivo/rango esperado de cada medición por producto. Los rangos de `schema_json` (ADR-001) son cotas **físicas/estructurales** (gate de guardado), no objetivos de calidad. Esta feature agrega: (1) una pantalla de administración del maestro con alta/edición y auditoría append-only; (2) especificaciones de calidad por producto, versionadas; (3) comparación medido-vs-estándar en vivo en los formularios de captura.

**Aprobado por (cadena completa, sin veto):** `scm-alimentos` (reglas de negocio) → `arquitecto-industrial` (modelo de datos y convivencia con ADR-001) → `backend-senior` (repository + service) → `frontend-ux` (UI admin + indicador en vivo) → `seguridad-analista` (aprobado con observaciones NO bloqueantes M1/B1/B2 — ver deuda).

> **Nota de numeración:** durante el desarrollo el código de esta feature referenciaba el ADR como "ADR-014" en comentarios, pero **014 ya estaba tomado** por el pooler/DIRECT_URL — el número correcto es **ADR-015**. **Corregido el 2026-07-21** en todos los comentarios de código y del schema (`roles.ts`, `especificaciones.ts`, `maestro-http.ts`, `maestro.repository.ts`, `EspecCampo` en `types/calidad.ts`, `IndicadorSpec.tsx`, `EspecificacionesEditor.tsx`, `especificaciones/route.ts`, `[puntoControlId]/page.tsx`, `seed.ts`, `schema.prisma`). **Dos referencias a "ADR-014" quedan a propósito:** (a) `src/lib/prisma.ts` — es la referencia legítima al pooler/DIRECT_URL; (b) el comentario del SQL en `migrations/20260721170200_.../migration.sql` (dice "ADR-006/ADR-014") — no se edita para no romper el checksum de la migración ya aplicada; es solo un comentario sin efecto.

### Modelo de datos — 4 tablas nuevas

Migración `prisma/migrations/20260721170200_maestro_admin_especificaciones/`. Diccionario de datos completo más abajo (sección "Modelo de datos").

1. **`Parametro` (`parametros`):** catálogo **CERRADO** de parámetros especificables (`clave` unique, `nombre`, `unidad`). Solo el admin/seed agrega parámetros nuevos. No es un campo de texto libre — la lista de qué se puede especificar está acotada.
2. **`PuntoControlParametro` (`puntos_control_parametros`):** binding estructural (punto de control × parámetro) → `campoData` (clave o JSON-path dentro de `RegistroCalidad.data`) + `agregacion` (enum `escalar` / `array_cada` / `array_promedio` / `derivado`). Resuelve el mapeo "este parámetro se compara contra este campo del formulario, y así se agrega" sin hardcodeo. Es **estructura derivada de los `schema_json`**, se siembra en el seed — no es dato de negocio editable por el admin.
3. **`EspecificacionProducto` (`especificaciones_producto`):** la spec de calidad, **versionada append-only**, por la terna (producto × punto de control × parámetro). Campos: `objetivo`, `aceptacionMin/Max`, `criticoMin/Max` (`Decimal(10,4)`), `esCritico`, `version`, `vigenteDesde/Hasta` (timestamptz), `creadoPorId`. **No tiene campo `activo`** — la única verdad de vigencia es `vigenteHasta IS NULL`. Un índice único **PARCIAL** (`especificaciones_producto_vigente_unica WHERE vigente_hasta IS NULL`, SQL crudo en la migración porque Prisma no lo expresa en el DSL) garantiza a lo sumo UNA versión vigente por terna.
4. **`AuditoriaMaestro` (`auditoria_maestro`):** log **append-only** que cubre `Producto`/`Marca`/`Familia`/`EspecificacionProducto`, con snapshot antes/después + usuario, escrito dentro de la misma transacción de cada cambio. Mismo criterio HACCP que `AuditoriaRegistro` (ADR-001). Cierra la deuda "sin auditoría append-only sobre el maestro" de ADR-010.

### Reglas de negocio (aprobadas por scm-alimentos + arquitecto-industrial, confirmadas por el usuario)

1. **Spec por (producto × PUNTO DE CONTROL × parámetro)**, no solo por producto. Un mismo parámetro (ej. peso) tiene un target distinto según la estación de medición: no es lo mismo el peso en relleno, en bañado o en el conformado final.
2. **Versionado con vigencia, append-only estricto.** Editar una spec **no pisa** la anterior: en la misma transacción y con el mismo timestamp `T` se cierra la versión vigente (`vigenteHasta = T`) y se abre una nueva (`vigenteDesde = T`, `version + 1`). La "spec vigente para un registro dado" se reconstruye por ventana temporal `[vigenteDesde, vigenteHasta)` contra el `createdAt` del registro. **Sin FK dura registro→spec** (la relación es por ventana temporal, no por clave). Correcciones = versión nueva, nunca pisar ni borrar.
3. **Tres capas de límite:** objetivo (target) + rango de aceptación (operativo/de calidad) + límite crítico (inocuidad/PCC, el envolvente externo). `min` y `max` son independientes en cada capa (tolerancia asimétrica legítima). **Superar el límite crítico NO bloquea el guardado** — el punto HACCP es *registrar* la desviación, no impedir que se cargue. El **flujo formal de tratamiento de desviación de PCC (acción correctiva + firma) quedó DIFERIDO** a una fase futura; el modelo ya deja el lugar con `criticoMin/Max` + `esCritico`.
4. **Convivencia con `schema_json`/AJV (ADR-001):** `schema_json` sigue siendo la validación estructural + cota física, y es el **gate de guardado**. La spec por producto es la **capa de objetivo de calidad**: se muestra en vivo y colorea la medición, pero **no toca el gate de guardado**. Decisión explícita: **no apretar los rangos de `schema_json`** hasta volverlos rangos de calidad — si se hiciera, el sistema empezaría a rechazar (perder) justamente los registros de desviación que HACCP necesita conservar.
5. **La unidad del parámetro es informativa**, sin enforcement de que coincida con la unidad del campo medido (`schema_json` no tiene metadata de unidad). Es un control de revisión humana, no automático.
6. **`peso_baño` usa agregación `derivado`:** se evalúa al cierre de jornada (promedio de restas apareadas, ADR-008), no medición por medición — por eso no se compara en vivo.
7. **Edición del maestro: SOLO rol `admin`** (`ROLES_ADMIN_MAESTRO` en `src/lib/auth/roles.ts`). Es configuración crítica de trazabilidad de exportación; el resto de roles solo consulta.

### Capas implementadas

- **Repository** `src/db/maestro.repository.ts`: CRUD de Producto/Marca/Familia + `versionarEspecificacion` + `cerrarEspecificacion` + auditoría en transacción + `getEspecificacionesCaptura` (specs vigentes de un producto para un punto de control, con su binding, listo para el formulario). Lecturas: `getProductosMaestro`, `getMarcas`, `getFamilias`, `getParametros`, `getBindings`, `getEspecificacionesVigentesDeProducto`, `getTodasEspecificacionesVigentes`, `getHistorialEspecificacion`.
- **Service** `src/services/calidad/maestro.service.ts`: validación Zod + reglas de negocio. Valida el **ordenamiento de límites** (crítico ⊇ aceptación ∋ objetivo; `min <= max` en cada par); verifica que las refs (familia/marca/línea) y el binding (punto de control × parámetro) existan antes de escribir. Contrato de resultado discriminado por `ok`, igual que los otros services.
- **API (solo escritura, solo admin):** 7 endpoints REST bajo `/api/v1/calidad/maestro/`, con gate compartido `src/lib/calidad/maestro-http.ts` (`gateAdminMaestro` + `parseBody` + `responder` + mapa `code→status`). Ver `docs/api-reference.md`.
- **Lecturas por Server Component, NO GET HTTP:** tanto el módulo admin como la captura leen del repository directamente desde Server Components — no hay ruta HTTP de lectura para estas entidades (mismo criterio que el resto del repo).
- **Helper puro** `src/lib/calidad/especificaciones.ts`: `evaluarValor(valor, spec)` → `dentro` / `fuera_aceptacion` / `fuera_critico` / `sin_spec` (bordes inclusivos, `min`/`max` evaluados de forma independiente); `formatearRango(spec, unidad)`. Testeable sin framework (`especificaciones.test.ts`).
- **UI admin:** `src/app/calidad/maestro/page.tsx` + `src/components/calidad/maestro/*` (`MaestroView`, `ProductosPanel`, `EspecificacionesEditor`, `CatalogoPanel`). La card de entrada en `src/app/calidad/page.tsx` solo se muestra al rol admin.
- **Comparación en vivo:** el tipo `ProductoActivoLinea` (`src/types/calidad.ts`) ganó `especificaciones?: EspecCampo[]`, poblado en el Server Component `[lineaId]/[puntoControlId]/page.tsx` con **falla suave** (si la resolución de specs falla, el formulario sigue funcionando sin el indicador). El componente `src/components/calidad/IndicadorSpec.tsx` está integrado en `TemperaturaForm`, `ProduccionDiariaForm` y `PesoMedicionesForm` — muestra el rango objetivo y colorea dentro/fuera de spec.

### Seed

Catálogo de **13 parámetros + 14 bindings** (`prisma/seed.ts`), estructura derivada de los `schema_json` existentes. **Sin backfill de especificaciones** — los rangos por producto son dato de calidad y se cargan a demanda desde el módulo admin. **Actualización (ver ADR-016):** el catálogo creció a 15 parámetros y 18 bindings al agregar "Control Peso Tapas" — ver esa sección para el detalle de qué se sumó.

### Verificación

99 tests en total (nuevos: helper `especificaciones` + `maestro.service`). Typecheck limpio. Verificado en browser contra Supabase real: el admin carga 104 productos; se guardó una spec real (Alfajor Negro, peso 72–78 / crítico 68–82, version 1 vigente en DB); el formulario de Peso Alfajor muestra "objetivo 72–78 g" y colorea las mediciones.

### Deuda técnica conocida (de `seguridad-analista`, aprobado con observaciones — NO bloqueante)

- **M1 (Medio):** `auditoria_maestro` y `AuditoriaRegistro` son append-only solo a nivel aplicación; a nivel motor, el rol de la app todavía tiene `UPDATE`/`DELETE` sobre esas tablas. **Antes de entrar al circuito de exportación Arcor:** `REVOKE UPDATE, DELETE` para el rol de la app, o triggers `BEFORE UPDATE/DELETE` que bloqueen la modificación.
- **B1 (Bajo):** sin rate limiting en los endpoints de escritura del maestro (reusar el patrón de `rate-limit-login.ts` si se agrega).
- **B2 (Bajo):** TOCTOU benigno en `verificarRefsProducto` — si una ref (familia/marca/línea) se borra entre el `findUnique` de verificación y el `create`, el resultado es un 500 (P2003) en vez de un 404/409 claro. Benigno hoy (no hay borrado de esas entidades desde la app).
- **Dato pendiente del usuario:** falta la lista real de PCC del plan HACCP para marcar `esCritico` correctamente en las specs (hoy `esCritico` queda en `false` por defecto).
- **Diferido:** el flujo formal de tratamiento de desviación de PCC (acción correctiva + firma) — el modelo ya deja el lugar (`criticoMin/Max` + `esCritico`).

---

## ADR-016: Bug crítico corregido — "Control Peso Tapas" como punto de control propio (relevamiento de planillas físicas TAPAS)

**Contexto:** el usuario relevó las planillas físicas reales de planta para el producto TAPAS y encontró que "Control Peso Baño Alfajor" servía **dos** modos de UI (alfajor estándar y "tapitas") bajo un único `schema_json` compartido, pero el payload que armaba el modo tapitas nunca coincidió con ese schema. **Confirmado por consulta directa a `registros_calidad`: 0 registros se guardaron jamás para TAPAS** desde que existe ese modo — un bug crítico de guardado, no una desprolijidad cosmética.

**Aprobado por (cadena completa, sin veto):**

1. **`scm-alimentos`** — auditó las 5 reglas de negocio propuestas (cálculo de cobertura por resta apareada por observación, escurrimiento opcional, `temp_interna` opcional, filtro de insumos por familia, relabel "Pico N"). Dictamen "válida con ajustes", con 3 puntos bloqueantes hasta que el usuario los definiera. **Resueltos por el usuario:** (a) la 3ª fila "BAÑO" del diseño viejo no correspondía — el proceso real es 2 pesadas + resta calculada, se elimina; (b) `temp_interna` **SÍ es PCC** — permanece obligatorio en el schema (se descartó hacerlo opcional); (c) no hace falta insumo de packaging para TAPAS, alcanza con 2 insumos.
2. **`arquitecto-industrial`** — aprobó crear un `PuntoControl` **nuevo y separado** ("Control Peso Tapas") en vez de forzar un schema `oneOf`/condicional compartido, consistente con ADR-001 ("un punto de control = un schema_json", nunca hardcodeo condicional por familia dentro de un mismo schema). Confirmó que reutilizar los mismos `Parametro` lógicos (`peso_tapa`, `temp_bano`) con **bindings nuevos por punto de control** es el diseño correcto de ADR-015 — no se duplican parámetros de catálogo por PC. No hizo falta migración de Prisma (todo son filas nuevas vía seed). Condición: el servidor no debe confiar ciegamente en el cálculo de cobertura hecho en el cliente sin un chequeo mínimo de plausibilidad — cubierto por los límites `minimum`/`maximum` de `mediciones_cobertura` en el `schema_json` del PC nuevo (mismo patrón que ya usa `peso_bano` estándar; no se agregó recálculo server-side completo, ver deuda).
3. **Implementación** (backend: seed + helper puro; frontend: formularios).
4. **`seguridad-analista`** — aprobado con observaciones, **sin veto**. Encontró un **hallazgo Alto real** (confirmado contra la DB, no hipotético): el seed solo hacía `upsert` de `PuntoControlFamilia` y **nunca borraba** la relación vieja `pcPesoBano↔famTapas` — esa fila seguía viva en la base real tras correr el seed nuevo, reintroduciendo la ambigüedad de origen del bug ("2 puntos de control de peso mostrados a la vez para tapas"). **Corregido de inmediato**: se agregó un `deleteMany` explícito antes del upsert (`prisma/seed.ts`, mismo patrón que ya usaba el seed para limpiar la relación de `pcFechadoEnvase`), y se confirmó por consulta directa que la fila vieja ya no existe. Otros hallazgos, no bloqueantes (ver "Deuda" abajo): recálculo server-side de cobertura (Medio, deuda aceptada — mismo patrón que `peso_bano`), filtro de insumos por familia sin enforcement server-side (Bajo, mismo patrón preexistente del repo), `lote_pt` sin `minLength` (Bajo).

### Modelo de datos — filas nuevas, sin migración

- **Nuevo `PuntoControl` "Control Peso Tapas"** (`tipoFormulario: peso_bano`, reutilizado — el dispatch de componente ya distingue el modo por la familia del producto activo, no hace falta un enum nuevo). Su `schema_json` (`schemaPesoTapas`, `prisma/seed.ts`) requiere: `mediciones_tapa[12]` (peso tapa sin bañar, 0–50g), `mediciones_tapa_con_bano[12]` (peso tapa con baño, 0–60g), `mediciones_cobertura[12]` (calculado en el cliente por resta apareada `con_baño[i] − sin_bañar[i]`, rango de **plausibilidad física** `[-10, 30]` — no el rango de calidad, que vive en `EspecificacionProducto`, ver ADR-001/ADR-015), `temp_ambiente`, `temp_bano` (ambas obligatorias); `escurrimiento` opcional.
- **"Control Peso Baño Alfajor" (el PC preexistente)** pierde la asociación con la familia `tapas` (fix del hallazgo Alto de seguridad, ver `deleteMany` arriba) — vuelve a ser exclusivo de `alfajor_negro`. Su `schema_json` (`schemaPesoBano`) también pasa `escurrimiento` a **opcional** (antes obligatorio) — mismo criterio: no se mide en cada muestra en la práctica de planta.
- **Nuevos parámetros de catálogo** (ADR-015): `peso_cobertura` (g) y `temp_interna` (°C — el comentario del seed lo marca como PCC del plan HACCP; **hoy el catálogo lo soporta pero no hay ninguna `EspecificacionProducto` cargada** con `esCritico: true` para `temp_interna` — pendiente que el usuario complete la lista de PCC del plan HACCP, ver deuda).
- **Nuevos bindings** (`PuntoControlParametro`) en "Control Peso Tapas": `peso_tapa`→`mediciones_tapa` (`array_cada`, reutiliza el `Parametro` ya usado en "Control Peso Alfajor" pero con `campoData` propio), `peso_cobertura`→`mediciones_cobertura` (`array_cada`), `temp_bano`→`temp_bano` (`escalar`). Nuevo binding en "Control Temperatura Condensación Túnel": `temp_interna`→`temp_interna` (`escalar`). El catálogo pasa de 13 a **15 parámetros** y de 14 a **18 bindings** (ver ADR-015 para la línea de base).
- **Nuevo valor de enum** `tapas_sin_banar` en `schemaTrazabilidadInsumos` (catálogo de insumos de "Trazabilidad Insumos"): la tapa cruda que entra al proceso de baño de TAPAS — distinto de `tapas_banadas` (la tapa YA bañada, insumo de ENTRADA para armar alfajores; no corresponde trazarla al producir TAPAS, sería trazar la salida del propio proceso como si fuera un insumo).
- Descripción de frecuencia corregida en "Control Temperatura Condensación Túnel" ("cada 30 min" → "cada hora") — cosmético, sin cambio de schema.

### Frontend

- **`src/lib/calidad/peso-cobertura.ts`** (nuevo, con test): helper puro `calcularCoberturaPorObservacion(tapa, tapaConBano)` — resta apareada pico a pico, tolera posiciones incompletas (da `NaN` en esa posición sin romper el resto).
- **`src/components/calidad/PesoMedicionesForm.tsx`:** el modo "Tapitas" se reescribió completo — 2 filas capturadas (antes 3, se eliminó la fila manual "BAÑO" que no correspondía) + 1 fila derivada (cobertura, no editable, calculada en vivo) con indicador de fuera de especificación por celda y un resumen "N valores fuera de especificación" al completar la muestra. Relabel "P1..P12" → "Pico 1..Pico 12" en los 3 formularios de peso (Alfajor, Relleno, Tapas) — cada posición es un pico dosificador físico de la máquina (confirmado por el usuario).
- **`src/components/calidad/ProduccionDiariaForm.tsx`:** el campo "Peso del alfajor" ahora se oculta (y no se envía en el payload) cuando `productoActivo.familiaSlug !== "alfajor_negro"`. El campo "Lote PT" volvió a ser **editable** (ver ADR-011, actualización): default = `productoActivo.numeroLote` (sugerido, mostrado en verde), editable con override persistido en `sessionStorage` (clave `calidad:lotePt:{lineaProductivaId}:{loteId}` — se resetea solo si cambia el lote activo de la línea) y un botón "Usar sugerido" para volver al valor por defecto.
- **`src/components/calidad/TrazabilidadInsumosForm.tsx`:** la lista de insumos seleccionables se filtra por `productoActivo.familiaSlug` — con TAPAS activo solo se ofrecen "Tapas Sin Bañar" y "Cobertura de Chocolate"; con alfajor activo, sigue mostrando los 4 insumos originales (uno renombrado de "Baño Chocolate" a "Cobertura de Chocolate" para alinear con el lenguaje real de planta). **Filtro solo de UI, sin enforcement server-side** (mismo patrón preexistente del resto del repo — deuda conocida, no bloqueante).

### Verificación

- 107 tests (14 suites) verdes, typecheck limpio.
- Verificación **aislada** (sin escribir en la DB) del punto crítico: se comparó el `schema_json` real ya sembrado contra el payload exacto que arma el nuevo código — el payload nuevo (con y sin escurrimiento) valida `true`; un payload con la forma vieja rota (con `mediciones_bano` + `familia`) sigue siendo rechazado por las razones correctas (`additionalProperties`, falta `mediciones_cobertura`).
- Verificado en browser con Alfajor activo (no se activó TAPAS en la línea real para no escribir datos de negocio sin pedido explícito del usuario): "Control Peso Baño Alfajor" sigue visible para alfajor y "Control Peso Tapas" correctamente oculto (aparece solo con familia tapas); "Peso del alfajor" sigue visible en Producción Diaria; Lote PT editable con override persistente confirmado; Trazabilidad Insumos muestra los 4 insumos originales con alfajor activo.
- **Hallazgo Alto de seguridad-analista corregido**: `deleteMany` agregado en el seed para la relación vieja `pcPesoBano↔famTapas`, confirmado por consulta directa que la fila ya no existe tras re-correr el seed.

### Deuda técnica conocida de esta feature (aceptada, no bloqueante)

- **(Medio) Sin recálculo server-side de la cobertura de tapas.** El servidor confía en la resta apareada calculada en el cliente, con el `minimum`/`maximum` de `schema_json` como único chequeo de plausibilidad — mismo patrón ya aceptado para `peso_bano` estándar (ADR-008). Decisión de negocio ya cubierta por el rango que definió `scm-alimentos`/`arquitecto-industrial`, no un descuido nuevo.
- **(Bajo) Filtro de insumos por familia (`TrazabilidadInsumosForm`) es solo de UI**, sin enforcement server-side — mismo patrón preexistente del resto del repo (ver también el filtro de familia de PCs en ADR-012, tampoco enforced server-side).
- **(Bajo) `lote_pt` sin `minLength`** en el schema de Producción Diaria — riesgo bajo, no bloqueante.
- **`temp_interna` sigue sin ninguna `EspecificacionProducto` cargada con `esCritico: true`** — el catálogo/bindings están listos, falta que el usuario complete la lista real de PCC del plan HACCP (deuda de arrastre de ADR-015).

### Pendiente para el usuario (no bloqueante, próximo paso)

- Activar TAPAS en Línea 3 requiere cargar `Producto.vidaUtilMeses` para ese producto desde `/calidad/maestro` (bloqueo `409 PRODUCTO_SIN_VIDA_UTIL`, ADR-013) — no se tocó ese dato porque es dato de negocio real que le corresponde cargar al usuario.
- Cargar la `EspecificacionProducto` de `peso_cobertura`/`peso_tapa`/`temp_ambiente`/`temp_bano` para el producto TAPAS real (hoy no hay ninguna spec cargada para TAPAS).
- Cargar la lista real de PCC del plan HACCP para poder marcar `esCritico: true` en la spec de `temp_interna` cuando corresponda.
- Prueba end-to-end completa de guardado real de un registro en "Control Peso Tapas" contra la DB (la verificación de esta sesión fue aislada/sin escritura) — recomendado hacerla la primera vez que se active TAPAS con los datos de maestro completos.

---

## Integración OT (PLC/SCADA) — diseño previsto, NO implementado

Hoy no hay ninguna integración (tampoco con SAP). A futuro se integrarán PLC/SCADA de planta. Restricción no negociable de cualquier diseño que se apruebe: **separación IT/OT** — la red OT no expone la base de datos ni consume la API directamente sin una capa intermedia. El detalle del diseño se documentará cuando `arquitecto-industrial` lo apruebe.

---

## Modelo de datos — Maestro de productos

(Complementa el schema Prisma en `prisma/schema.prisma`, que es la fuente de verdad del DDL. Ver ADR-010 para el razonamiento de diseño del maestro, ADR-012 para `LineaProduccionEstado`/`LineaActivacionLog`, y ADR-015 para las tablas de especificaciones.)

### Diagrama entidad-relación (simplificado)

```
Marca (1) ──< (N) Producto (N) >── (1) Familia
                    │
                    │ (N, opcional)
                    ▼
              LineaProductiva (1)
                    │
                    │ (1) >── (N) Lote ──> (0..1) OrdenProduccion  [OP: módulo no construido]
                    │               │
                    │               │ (0..1)
                    │               ▼
                    │         Usuario (creadoPorId, ver ADR-011)
                    │
                    │ (1) >── (0..1) LineaProduccionEstado ──> (1) Lote  [puntero "producto activo hoy", ver ADR-012]
                    │                       │
                    │                       │ (1)
                    │                       ▼
                    │                 Usuario (activadoPorId)
                    │
                    │ (1) >── (N) LineaActivacionLog ──> (1) Lote, (1) Usuario  [historial append-only, ver ADR-012]

Familia (1) ──< (N) PuntoControlFamilia >── (N) PuntoControl

Producto (1) ──< (N) EspecificacionProducto >── (1) PuntoControl, (1) Parametro   [spec versionada, ver ADR-015]
PuntoControl (1) ──< (N) PuntoControlParametro >── (1) Parametro                  [binding parámetro↔campo, ver ADR-015]
```

### Marca (`marcas`)

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | `String` unique | "GOAT", "LC", "ARCOR", "CARREFOUR"... |
| `lineaNegocio` | enum `LineaNegocio` (`marca_propia`, `copacker_arcor`, `fason_terceros`) | Atributo de la marca, no del producto — ver ADR-010. |
| `activa` | `Boolean` default `true` | |

### Familia (`familias`)

| Campo | Tipo | Notas |
|---|---|---|
| `slug` | `String` unique | "alfajor_negro", "tapas" — clave de UI y de dispatch de formularios/filtros. |
| `nombre` | `String` unique | Tal cual viene del maestro ("ALFAJOR NEGRO", "TAPAS", "BUDIN EUR"...). |
| `activa` | `Boolean` default `true` | |

### PuntoControlFamilia (`puntos_control_familias`)

Tabla puente `puntoControlId` + `familiaId` (PK compuesta). Declara qué familias aplican a cada punto de control — reemplaza el hardcodeo de familias que antes vivía en componentes del frontend. Mismo patrón que `puntos_control_lineas`.

**Actualización (ver ADR-016):** "Control Peso Baño Alfajor" (`pcPesoBano`) es exclusivo de `alfajor_negro` — la relación con `tapas` que tenía antes se eliminó explícitamente (`deleteMany` en el seed, fix del hallazgo Alto de `seguridad-analista`). TAPAS tiene su propio punto de control ("Control Peso Tapas", `pcPesoTapas`) asociado únicamente a la familia `tapas`. El seed sigue solo **agregando** relaciones vía `upsert` — cualquier reasignación de familia a futuro que implique **quitar** una relación existente necesita el mismo patrón de `deleteMany` explícito antes del upsert, no alcanza con cambiar el array de `relacionesFamilias`.

### Producto (`productos`)

| Campo | Tipo | Notas |
|---|---|---|
| `sku` | `String?` unique | Nullable: 34/104 productos del maestro real no tienen código asignado. `UNIQUE` en Postgres admite múltiples `NULL` sin conflicto. |
| `nombre` | `String` unique | Descripción estándar completa del maestro ("Familia; Gusto; Marca; Peso; Unid/caja"). Es la clave de upsert del import. |
| `familiaId` | FK → `Familia`, requerida | |
| `marcaId` | FK → `Marca`, requerida | Define la línea de negocio vía `Marca.lineaNegocio`. |
| `lineaProductivaId` | FK → `LineaProductiva`, opcional | No todos los productos del maestro tienen línea asignada en el Excel origen. **No validado hoy contra la línea que se activa en ADR-012 — ver deuda conocida.** |
| `gusto` | `String?` | |
| `pesoGramos` | `Decimal(8,2)?` | |
| `unidadesPorCaja` | `Decimal(8,2)?` | Semielaborados traen valores no enteros (ej. TAPAS = 751,87). |
| `rendimientoTeorico` | `Decimal(10,2)?` | Se interpreta según `unidadRendimiento`. |
| `unidadRendimiento` | enum `UnidadRendimiento` (`unidades_hora`, `cajas_amasijo`) | |
| `cajasPorPallet` | `Int?` | |
| `vidaUtilMeses` | `Int?` | Vida útil en meses desde fecha de producción — origen del vencimiento de PT (`MM/yyyy`) y, desde ADR-013, del segmento `DD/MM/AAAA` de `Lote.numeroLote` en el flujo automático. También viaja en `ProductoActivoLinea` (ver ADR-012) para no regresionar la auto-sugerencia en `ProduccionDiariaForm`. **Desde ADR-013, `null` o `<= 0` bloquea la activación del producto en una línea (`409 PRODUCTO_SIN_VIDA_UTIL`)** — 9/104 productos del maestro real no lo tienen cargado hoy (incluye TAPAS, ver ADR-016 "Pendiente para el usuario"). |
| `pesoMasaCrudaG` | `Decimal(8,2)?` | |
| `esSemielaborado` | `Boolean` default `false` | Detectado en el import por texto "semi-elaborado" en la columna OBS del maestro. |
| `observaciones` | `String?` | |
| `descripcionVieja` | `String?` | Descripción legacy del maestro origen, solo referencia. |
| `nomenclaturaLote` | `String?` | Dato dormido en el schema/maestro, no consumido en `src/`. **Ver ADR-011 actualización 2026-07-21 (ADR-016):** el campo "Lote PT" de Producción Diaria pasó de solo-lectura a sugerido-editable, pero sigue sin consumir `nomenclaturaLote` — la sugerencia usa `Lote.numeroLote` (el `Lote` administrativo activo), no este campo. |
| `activo` | `Boolean` default `true` | |
| `updatedAt` | `DateTime` | Nuevo — antes `Producto` no trackeaba actualizaciones. |

**Reglas de integridad:** `sku` y `nombre` únicos (con `null` múltiple permitido en `sku`); `familiaId` y `marcaId` `NOT NULL`; `lineaProductivaId` opcional. Índices en `familiaId`, `marcaId`, `lineaProductivaId` (ver ADR-010, punto 6).

**Edición desde la app (desde ADR-015):** `Producto`, `Marca` y `Familia` tienen alta/edición vía el módulo admin (`POST`/`PATCH /api/v1/calidad/maestro/{productos,marcas,familias}`, solo rol `admin`), con auditoría append-only en `auditoria_maestro`. El script de import (`npm run db:import-productos`) sigue siendo la vía de carga masiva.

### Lote (`lotes`)

Ver ADR-011 para el razonamiento del alta manual, ADR-012 para el find-or-create de "producto activo por línea", y ADR-013 para el formato definitivo de `numeroLote` en el flujo automático.

| Campo | Tipo | Notas |
|---|---|---|
| `numeroLote` | `String` unique | Identifica la corrida de producción en curso. **Dos formatos posibles según el origen del lote (ver ADR-013):** `L-DD/MM/AAAA-AJJJ-hh:mm-ENV` cuando el lote se creó vía "producto activo por línea" (tiene código de línea disponible); `GEN-{yyyyMMdd}-{HHmmss}` (placeholder legacy) cuando se creó vía el alta manual (`/calidad/lotes/nuevo`), que no asocia línea productiva. **No confundir con `Producto.nomenclaturaLote`.** Desde ADR-016, este es también el valor que sugiere (editable) el campo "Lote PT" de Producción Diaria. |
| `productoId` | FK → `Producto`, requerida | |
| `ordenProduccionId` | FK → `OrdenProduccion`, opcional | Para cuando se construya el módulo de Producción (hoy no existe UI/proceso que lo cree — un lote puede existir sin OP, captura directa desde planta). |
| `lineaProductivaId` | FK → `LineaProductiva`, opcional | Agregado en ADR-012. Nullable porque coexiste con lotes históricos sin línea (previos a esta feature) y con futuros lotes de `OrdenProduccion`. |
| `fechaProduccion` | `Date` | |
| `estado` | enum `EstadoLote`, default `en_produccion` | |
| `notas` | `String?` | Texto libre opcional, cargado en el alta. |
| `createdAt` | `DateTime` default `now()` | |
| `creadoPorId` | `String?` (UUID) FK → `Usuario`, `onDelete: SetNull` | Nullable — ver ADR-011 (auditoría de autoría y riesgo residual). |

**Reglas de integridad:** `numeroLote` unique; `productoId` `NOT NULL`; `ordenProduccionId`, `lineaProductivaId` y `creadoPorId` opcionales. **`@@unique([productoId, lineaProductivaId, fechaProduccion])`** (ADR-012) — habilita el find-or-create de producto activo por línea; es independiente del unique de `numeroLote`. Índices: `productoId`, `[estado, fechaProduccion]` (cubre `getLotesActivos`), `creadoPorId`.

### LineaProduccionEstado (`linea_produccion_estado`)

Ver ADR-012. Puntero mutable, un registro por línea (PK = `lineaProductivaId`).

| Campo | Tipo | Notas |
|---|---|---|
| `lineaProductivaId` | `String` (UUID), PK, FK → `LineaProductiva` | |
| `loteActivoId` | `String` (UUID) unique, FK → `Lote`, `onDelete: Restrict` | Un lote no puede ser "activo" de más de una línea a la vez. |
| `activadoPorId` | `String` (UUID), FK → `Usuario`, `onDelete: Restrict` | |
| `activadoEn` | `DateTime` | Se compara contra la fecha consultada en `getProductoActivoDeLinea` — si no coincide con hoy, se trata como "sin producto activo". Desde ADR-013, "hoy" en el find-or-create de escritura y en las dos lecturas de `getProductoActivoDeLinea` (endpoint del asistente y Server Component de la grilla) usan la "jornada productiva" (corte 6am-6am), no el día calendario — ver esa sección. |

### LineaActivacionLog (`linea_activacion_log`)

Ver ADR-012. **Append-only** — nunca `update`/`delete`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String` (UUID), PK | |
| `lineaProductivaId` | FK → `LineaProductiva`, `onDelete: Restrict` | |
| `loteId` | FK → `Lote`, `onDelete: Restrict` | |
| `usuarioId` | FK → `Usuario`, `onDelete: Restrict` | |
| `createdAt` | `DateTime` default `now()` | Índice `[lineaProductivaId, createdAt]` — cubre las consultas del guard anti-abuso (ADR-012). |

### Parametro (`parametros`) — ADR-015

Catálogo **CERRADO** de parámetros especificables. Solo admin/seed agrega. **15 parámetros sembrados hoy** (13 desde ADR-015 + `peso_cobertura` y `temp_interna` agregados en ADR-016).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String` (UUID), PK | |
| `clave` | `String` unique | Ej. `peso_alfajor`, `temp_ddl`, `humedad_relativa`, `peso_cobertura`, `temp_interna`. |
| `nombre` | `String` | Etiqueta legible ("Peso alfajor", "Temp. tanque DDL", "Temp. interna producto (PCC)"). |
| `unidad` | `String` | Informativa (no hay enforcement de que coincida con la unidad del campo medido — ADR-015, regla 5). |
| `activo` | `Boolean` default `true` | |
| `createdAt` / `updatedAt` | `DateTime` | |

### PuntoControlParametro (`puntos_control_parametros`) — ADR-015

Binding estructural: qué parámetros son medibles en cada punto de control, en qué campo de `data` viven y cómo se agregan. Se siembra en el seed (estructura derivada de los `schema_json`), no es dato editable por el admin. **18 bindings sembrados hoy** (14 desde ADR-015 + 4 agregados en ADR-016: `peso_tapa`→`mediciones_tapa`, `peso_cobertura`→`mediciones_cobertura` y `temp_bano`→`temp_bano` en "Control Peso Tapas"; `temp_interna`→`temp_interna` en "Control Temperatura Condensación Túnel").

| Campo | Tipo | Notas |
|---|---|---|
| `puntoControlId` | FK → `PuntoControl`, `onDelete: Cascade` | PK compuesta con `parametroId`. |
| `parametroId` | FK → `Parametro`, `onDelete: Cascade` | |
| `campoData` | `String` | Clave o JSON-path dentro de `RegistroCalidad.data` (ej. `mediciones`, `temp_ddl`, `filas[].peso_neto`, `mediciones_cobertura`). |
| `agregacion` | enum `AgregacionParametro` (`escalar`, `array_cada`, `array_promedio`, `derivado`) | `escalar` = valor único; `array_cada` = cada elemento del array se compara contra la misma spec; `array_promedio` = se compara el promedio; `derivado` = no se compara en vivo, se evalúa al cierre (ej. `peso_baño`). |

### EspecificacionProducto (`especificaciones_producto`) — ADR-015

Spec de calidad **versionada append-only** por la terna (producto × punto de control × parámetro). Editar = versión nueva; nunca se pisa ni se borra. Vigencia por ventana temporal.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String` (UUID), PK | |
| `productoId` | FK → `Producto`, `onDelete: Restrict` | |
| `puntoControlId` | FK → `PuntoControl`, `onDelete: Restrict` | |
| `parametroId` | FK → `Parametro`, `onDelete: Restrict` | |
| `objetivo` | `Decimal(10,4)?` | Target. |
| `aceptacionMin` / `aceptacionMax` | `Decimal(10,4)?` | Rango operativo/de calidad. |
| `criticoMin` / `criticoMax` | `Decimal(10,4)?` | Límite de inocuidad/PCC (envolvente externo). |
| `esCritico` | `Boolean` default `false` | Marca PCC. **Hoy siempre `false` por defecto** — falta la lista real de PCC del plan HACCP (dato pendiente del usuario, ver ADR-015 y ADR-016). |
| `version` | `Int` default `1` | Se incrementa en cada versión nueva de la misma terna. |
| `vigenteDesde` | `TIMESTAMPTZ` | Inicio de vigencia de esta versión. |
| `vigenteHasta` | `TIMESTAMPTZ?` | Fin de vigencia. **`NULL` = versión vigente.** No hay campo `activo` — esta es la única verdad de vigencia. |
| `creadoPorId` | FK → `Usuario`, `onDelete: Restrict` | Quién cargó esta versión. |
| `createdAt` | `DateTime` default `now()` | |

**Reglas de integridad:** índice único **PARCIAL** `especificaciones_producto_vigente_unica` sobre `(producto_id, punto_control_id, parametro_id) WHERE vigente_hasta IS NULL` — garantiza a lo sumo UNA versión vigente por terna (las versiones cerradas no cuentan, así el historial no colisiona). Es la red de seguridad dura del versionado append-only: aunque una transacción con bug intente abrir dos vigentes, Postgres la rechaza. Índice de consulta `(producto_id, punto_control_id, parametro_id, vigente_desde)`.

### AuditoriaMaestro (`auditoria_maestro`) — ADR-015

Log **append-only** de cambios sobre el maestro y las especificaciones. Escrito en la misma transacción del cambio auditado. Mismo criterio HACCP que `AuditoriaRegistro`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String` (UUID), PK | |
| `entidad` | enum `EntidadMaestro` (`producto`, `marca`, `familia`, `especificacion_producto`) | |
| `entidadId` | `String` (UUID) | ID de la fila auditada. |
| `accion` | enum `AccionAuditoria` (`crear`, `modificar`, `eliminar`, `restaurar`) | Reusa el enum ya existente de `AuditoriaRegistro`. |
| `snapshotAntes` | `JSONB?` | Estado previo (null en altas). |
| `snapshotDespues` | `JSONB?` | Estado nuevo. |
| `usuarioId` | FK → `Usuario`, `onDelete: Restrict` | |
| `createdAt` | `DateTime` default `now()` | Índices: `(entidad, entidadId)` y `(usuarioId, createdAt)`. |

**Deuda M1 (seguridad-analista):** append-only está garantizado solo a nivel aplicación (el código nunca hace `update`/`delete`), no a nivel motor — el rol de la app todavía tiene `UPDATE`/`DELETE`. Antes del circuito de exportación Arcor: `REVOKE` o triggers de bloqueo. Aplica igual a `AuditoriaRegistro`.

### enum TipoFormulario

- Se agregó `trazabilidad_insumos`.
- `fechado_envase` **queda en el enum por compatibilidad histórica**, pero el punto de control está desactivado (`activo: false` en seed): el control de fechado se hace en planilla física.
- **No se agregó ningún valor nuevo para TAPAS (ver ADR-016):** "Control Peso Tapas" reutiliza `peso_bano` — el dispatch de componente distingue el modo de UI por la familia del producto activo (`productoActivo.familiaSlug`), no por `tipoFormulario`.

### Punto de control "Trazabilidad Insumos" (Línea 3)

- Un registro por **cambio de lote de insumo** (no por turno).
- `data` JSONB: `{ insumo: tapas_sin_banar | tapas_banadas | bonobon | dulce_de_leche | bano_chocolate, lote_insumo, observaciones? }`. **`tapas_sin_banar` agregado en ADR-016** (2026-07-21) — la tapa cruda que entra al proceso de baño de TAPAS, distinta de `tapas_banadas` (la tapa ya bañada). En UI, `bano_chocolate` se muestra como "Cobertura de Chocolate" (relabel de ADR-016) y la lista visible se filtra por `productoActivo.familiaSlug` (solo de UI, sin enforcement server-side).
- Propósito: ante un recall, cruzar el momento del cambio de lote con el correlativo de pallets del día para acotar los pallets afectados.

### Punto de control "Control Peso Tapas" (Línea 3) — ADR-016

- Reutiliza `tipoFormulario: peso_bano`; se distingue de "Control Peso Baño Alfajor" por la familia del producto activo (`tapas` vs `alfajor_negro`), nunca ambos a la vez en la grilla (mismo `orden: 3`, mutuamente excluyentes por `PuntoControlFamilia`).
- `data` JSONB: `{ mediciones_tapa[12], mediciones_tapa_con_bano[12], mediciones_cobertura[12] (calculado en cliente), temp_ambiente, temp_bano, escurrimiento? }`.
- Ver ADR-016 para el detalle completo del bug corregido, el modelo de datos y la deuda conocida.

---

## Operación — Import del maestro de productos

Script one-shot: `scripts/import-maestro-productos.ts`.

```
npm run db:import-productos -- [ruta-al-xlsx]
```

- Default de ruta si no se pasa argumento: `C:\Users\Usuario\Desktop\Productos.xlsx`.
- Lee la hoja `"BD"` del Excel. Falla duro (`throw`) si esa hoja no existe.
- **Idempotente:** hace upsert por `nombre` (la descripción estándar completa) — correrlo dos veces no duplica productos, familias ni marcas.
- Parsea la columna "Descripción Nueva (Std)" con el formato `Familia; Gusto; Marca; Peso; Unid/caja`. Si una fila no tiene exactamente 5 partes separadas por `;`, esa fila se **saltea** con warning (no aborta el resto del import).
- Normaliza números: coma decimal (`"13,3"` → `13.3`), `"NA"`/vacío → `null`.
- Detecta `esSemielaborado` por texto ("semi-elaborado", case-insensitive) en la columna OBS del maestro — no es un campo explícito en el Excel.
- SKUs duplicados conocidos del maestro origen (hoy: `MADA200C12(B)`) se anulan (`sku = null`) y se deja nota en `observaciones` en vez de fallar el import.
- Asigna línea de negocio por marca con un mapeo **hardcodeado dentro del script** (`LINEA_NEGOCIO_POR_MARCA`): `ARCOR`/`GOAT` → `copacker_arcor`, `LC` → `marca_propia`, cualquier otra marca → `fason_terceros` por default. Asignación confirmada por el usuario el 2026-07-07 — si se suman marcas nuevas con otra línea de negocio, hay que tocar este mapeo a mano.
- Errores por fila individual (ej. conflicto de unicidad no contemplado) se capturan y se listan como warning al final; no abortan el import completo.
- Al finalizar imprime resumen: productos creados/actualizados, total de familias y marcas en base, y la lista completa de warnings.

**Precondición:** requiere que exista la línea `"Línea 3"` (creada por `npm run db:seed` — el nombre largo "Línea 3 — Conformado Alfajores" quedó obsoleto cuando el usuario renombró las líneas en Supabase, ver LOG_CONTEXTO 2026-07-13). Si no existe, los productos de línea 3 del maestro quedan sin línea asignada (warning, no aborta).

---

## Deuda técnica y decisiones pendientes (estado real, no aspiracional)

- **Migrations formales: ya existen.** Desde la feature de Alta de Lote (ADR-011) el repo tiene `prisma/migrations/` versionadas (`20260713164001_init`, `20260713184453_add_lote_creado_por`, `20260714120000_linea_producto_activo`, `20260720174244_secuencias_diarias_correlativos`, `20260721170200_maestro_admin_especificaciones`) — **corrección respecto a una versión anterior de este documento**, que decía que no existían y que el schema se aplicaba con `db push`. Sigue sin haber política escrita de rollback/revisión de migraciones aplicadas; tratarlas como inmutables una vez mergeadas (no editar una migración ya aplicada — estándar global del proyecto). **ADR-016 no agregó ninguna migración** — todo el cambio son filas nuevas de seed sobre tablas ya existentes.
- ~~Fallback demo embebido en la page, no gateado por `DEMO_MODE`.~~ **Resuelto (2026-07-20, `AUDIT_PLAN.md` Lote 1).** Ver ADR-007. Las tres instancias (`puntos-control/page.tsx`, `lotes/nuevo/page.tsx`, `[lineaId]/[puntoControlId]/page.tsx`) quedaron gateadas por `DEMO_MODE`.
- **Rate limiting en `authorize()` de NextAuth (`src/lib/auth.ts`), en `POST /api/v1/calidad/lotes` y en los endpoints de escritura del maestro (ADR-015, deuda B1).** Señalado por `seguridad-analista` como hallazgo no bloqueante hoy, pero a resolver antes de exponer el login o la escritura fuera de la red interna. El guard anti-abuso de ADR-012 (`producto-activo`) es puntual a ese endpoint, no la resolución de este punto transversal.
- ~~**Sin pantalla de administración del maestro.**~~ **Resuelto (2026-07-21, ADR-015).** Alta/edición de `Producto`/`Marca`/`Familia` ya tiene UI (`/calidad/maestro`) + API de escritura (`POST`/`PATCH /api/v1/calidad/maestro/...`, solo rol `admin`). El script de import sigue como vía de carga masiva.
- ~~**Sin auditoría append-only sobre `Producto`/`Marca`/`Familia`.**~~ **Resuelto (2026-07-21, ADR-015).** Existe `auditoria_maestro` (append-only, cubre `Producto`/`Marca`/`Familia`/`EspecificacionProducto` con snapshot antes/después, en la misma transacción del cambio). **Caveat M1 (seguridad-analista):** el append-only está garantizado solo a nivel aplicación; a nivel motor el rol de la app todavía tiene `UPDATE`/`DELETE`. Antes del circuito de exportación Arcor: `REVOKE UPDATE, DELETE` o triggers de bloqueo (aplica igual a `AuditoriaRegistro`).
- **Especificaciones de calidad por producto (ADR-015) — deuda residual no bloqueante:**
  - **B1 (Bajo):** sin rate limiting en los endpoints de escritura del maestro (ver punto transversal arriba).
  - **B2 (Bajo):** TOCTOU benigno en `verificarRefsProducto` — una ref borrada entre el `findUnique` y el `create` da un 500 (P2003) en vez de 404/409. Benigno hoy (no hay borrado de familia/marca/línea desde la app).
  - **Dato pendiente del usuario:** falta la lista real de PCC del plan HACCP para marcar `esCritico` correctamente en las specs (hoy `false` por defecto en todas, incluida `temp_interna` — ver ADR-016).
  - **Diferido:** el flujo formal de tratamiento de desviación de PCC (acción correctiva + firma) — el modelo ya deja el lugar (`criticoMin/Max` + `esCritico`).
- ~~**"Control Peso Baño Alfajor" servía dos modos de UI (alfajor/tapitas) bajo un schema compartido que nunca coincidió con el payload de tapitas — 0 registros de TAPAS guardados jamás.**~~ **Resuelto (2026-07-21, ADR-016).** Nuevo `PuntoControl` "Control Peso Tapas", separado, con su propio `schema_json`. Ver ADR-016 para el modelo completo, el fix del hallazgo Alto de `seguridad-analista` (relación `PuntoControlFamilia` vieja no limpiada) y la deuda residual (recálculo server-side de cobertura, `esCritico` de `temp_interna` pendiente de la lista real de PCC).
- **Sin relación BOM (bill of materials) semielaborado → producto terminado.** El modelo sabe que TAPAS `esSemielaborado`, pero no hay forma de declarar "ALFAJOR NEGRO usa TAPAS como insumo" — necesario a futuro para trazabilidad completa de recall (insumo semielaborado → producto terminado) y para cálculo de consumo.
- **Riesgo residual sobre `Lote.creadoPorId` (`onDelete: SetNull`)** si en el futuro se agrega borrado físico de `Usuario` — ver ADR-011. Hoy teórico (el borrado de usuarios es lógico, vía `activo`). Nota: las FK nuevas de ADR-012 (`LineaProduccionEstado`, `LineaActivacionLog`) y las de ADR-015 (`EspecificacionProducto`, `AuditoriaMaestro`) se definieron `onDelete: Restrict` en vez de repetir este patrón, precisamente para no sumar más puntos con el mismo riesgo.
- **No se valida `producto.lineaProductivaId` contra la línea activada** en `POST /api/v1/lineas-productivas/[lineaId]/producto-activo` — ver deuda conocida de ADR-012. (El selector de UI ya filtra por línea desde 2026-07-14, pero la validación server-side sigue ausente — un POST directo puede activar un producto de otra línea.)
- **Cero tests automatizados** en el repo — **corrección: ya no es preciso.** Vitest está configurado desde 2026-07-15; a la fecha de ADR-016 hay **107 tests** en varias suites (`fecha-planta`, `lote-pt`, `lote.service`, `linea-producto-activo.service`, `getTurnoByHora`, `calidad.repository.lote-numero`, `calidad.repository.secuencias`, `registro.service`, `especificaciones`, `maestro.service`, `peso-cobertura`). Sigue faltando cobertura de componentes UI y de la mayoría del repository con DB real.
- ~~**Inconsistencia de numeración ADR-015 en el código.**~~ **Resuelto (2026-07-21):** los comentarios se corrigieron a ADR-015. Quedan a propósito dos "ADR-014": `prisma.ts` (referencia legítima al pooler) y el comentario del SQL de la migración aplicada (no se edita para preservar el checksum). Ver la nota al inicio de ADR-015.
</content>
