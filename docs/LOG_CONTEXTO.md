# LOG DE CONTEXTO — Control de Producción La Cumbre

> Este archivo actúa como memoria estructurada del proyecto.
> Antes de proponer cambios arquitectónicos o de lógica de negocio, **leer este archivo completo**.
> Cada hito documenta decisiones que NO deben revertirse sin razón explícita.

---

### [2026-07-24] - Bug crítico transversal: AJV rechazaba valores decimales válidos por precisión de floats (`multipleOf: 0.1`)

- **Contexto:** el usuario reportó `400 Bad Request` en "Control Temperatura Condensación Túnel" ("2 registro(s) con datos inválidos"). El body del error mostraba `"Campo 'peso': must be multiple of 0.1, Campo 'temp_ambiente': must be multiple of 0.1"` para valores perfectamente normales (75.3, 18.2).
- **Causa raíz (transversal, no específica de este punto de control):** AJV valida `multipleOf` comparando `valor / divisor` contra un entero exacto. En floats de JS, `75.3 / 0.1 = 752.9999999999999` (no 753) — un valor válido de 1 decimal falla la comparación exacta por ruido de representación binaria. **`multipleOf: 0.1` está en casi todos los schemas del maestro** (pesos, temperaturas, humedad — al menos 25 campos en `prisma/seed.ts`), así que este bug podía estar afectando guardados en múltiples formularios, no solo uno. AJV soporta `multipleOfPrecision` para tolerar este ruido (`Math.abs(Math.round(res) - res) > 1e-{precision}` en vez de comparación exacta), pero `src/lib/validate-jsonb.ts` no lo tenía seteado.
- **Fix:** `new Ajv({ ..., multipleOfPrecision: 9 })` en `validate-jsonb.ts` — un solo lugar, corrige el problema para **todos** los schemas del sistema de una vez (no hace falta tocar cada `schema_json` individualmente, y no requiere ningún cambio en la DB). Se agregó `validate-jsonb.test.ts`: confirma que 75.3/18.2/60.2 ahora validan, que un valor genuinamente no-múltiplo (75.35) sigue siendo rechazado, y que errores de tipo no relacionados siguen detectándose.
- **Verificado end-to-end en browser** (server reiniciado con `.next` limpio para descartar caché): guardado real en Temperatura Condensación con los 8 campos decimales → `201 Created`. Registro de prueba + auditoría borrados después (mismo criterio que el hito anterior: entorno de prueba, verificado antes de borrar que era el único).
- **Nota:** el hito anterior del mismo día (Producción Diaria, patrón de fecha `vencimiento_pt` mal copiado) es un bug distinto y ya cerrado — no relacionado con este.
- Cambio técnico puro (configuración de la librería de validación), sin cadena de subagentes.
- Typecheck + 110 tests verdes.

---

### [2026-07-24] - Bug crítico corregido: Producción Diaria nunca guardó un registro (0 filas desde siempre)

- **Contexto:** el usuario reportó `400 Bad Request` al guardar en Producción Diaria — Línea 3 ("3 registro(s) con datos inválidos" en el card de error).
- **Causa raíz:** el JSON Schema de `produccion_diaria` (`prisma/seed.ts`) validaba `vencimiento_pt` contra el patrón `^\d{2}/\d{2}/\d{2}$` (formato DD/MM/AA) — copiado sin ajustar del schema de `fechado_envase` (otro campo, otro formato). Pero `calcularVencimiento()` (`src/lib/calidad/lote-pt.ts`) siempre generó `MM/AAAA` (ej. `"11/2026"`), que nunca matchea ese patrón. **Confirmado en DB: 0 filas en `registros_calidad` para este punto de control desde que existe la feature** — todo guardado falló silenciosamente (mismo patrón que el bug de TAPAS del 2026-07-21, otra vez un mismatch entre el payload real y el `schema_json`).
- **Fix:** patrón corregido a `^\d{2}/\d{4}$` en `prisma/seed.ts` (fuente de verdad) + `UPDATE` puntual sobre el `schema_json` del `PuntoControl` en la DB real (no se re-corrió el seed completo — evita el `deleteMany` de `puntoControlLinea`/`puntoControlFamilia` que no correspondía a este fix).
- **Verificado sin tocar datos reales primero**: script aislado con AJV que reprodujo el rechazo con el patrón viejo y confirmó la aceptación con el nuevo, antes de tocar la DB.
- **Verificado end-to-end en browser** (con permiso explícito del usuario, entorno de prueba): guardado real → `201 Created`. El registro y su entrada de auditoría se borraron después a pedido del usuario ("estamos en instancias de prueba") — excepción puntual a la regla de no-borrado físico de HACCP, aplicada solo a un registro de prueba propio, verificado antes de borrar que era el único y sin otras referencias.
- Cambio técnico puro (regex mal copiado), sin cadena de subagentes — no es regla de negocio ni cambio estructural.
- Typecheck + 107 tests verdes.

---

### [2026-07-22] - Maestro de Productos promovido a módulo top-level (hermano de Calidad)

- **Contexto:** el usuario indicó que el Maestro de Productos corresponde al mismo nivel jerárquico que el módulo Calidad, no anidado dentro de él. Es dato maestro transversal (lo consume Calidad, pero no es una función de Calidad).
- **Alcance (confirmado con el usuario: página + API, coherente):**
  - Página: `src/app/calidad/maestro/` → `src/app/maestro/` (ruta `/maestro`). Back-links internos `/calidad` → `/` ("Volver al inicio").
  - API: `src/app/api/v1/calidad/maestro/` → `src/app/api/v1/maestro/` (5 recursos: productos, marcas, familias + sus `[id]`, especificaciones). Se actualizaron los 4 fetch de los componentes cliente (`CatalogoPanel`, `EspecificacionesEditor`, `ProductosPanel`) y los comentarios de path en los route.ts.
  - Home (`src/app/page.tsx`): ahora async con `auth()`, muestra Calidad + Maestro como módulos hermanos; el Maestro está gateado a `admin` (mismo `ROLES_ADMIN_MAESTRO` de ADR-015). Grid pasa a 2 columnas cuando el maestro es visible.
  - Se quitó el Maestro de las funcionalidades del hub de Calidad (`src/app/calidad/page.tsx`) — el hub volvió a componente síncrono sin `auth()`.
- **NO se movió** la organización de archivos fuente internos (`components/calidad/maestro/`, `services/calidad/maestro.service.ts`, `lib/calidad/maestro-http.ts`) — son ubicaciones internas, no URLs; moverlas es churn sin beneficio visible y con riesgo de lock en Windows (ya se sufrió un EPERM en este mismo move por el file-watcher del dev server). Queda como deuda cosmética menor si algún día molesta.
- **Verificado en browser** (dev server limpio, tras borrar `.next` stale que arrastraba types del path viejo): home muestra ambos módulos como admin; `/maestro` carga los 104 productos; **escritura real end-to-end**: crear una familia pegó `POST /api/v1/maestro/familias → 201`. La familia de prueba se borró de la DB después (sin asociaciones, borrado directo seguro). Typecheck limpio, 107/107 tests verdes.
- **Nota de entorno (reincidente):** mover directorios bajo `src/app/` con un `next dev` corriendo falla con `Permission denied`/EPERM por el file-watcher; además `.next/types` queda con referencias al path viejo y hace fallar `tsc` con un falso positivo. Solución: reintentar el move, y borrar `.next` (o solo `.next/types/app/<ruta-vieja>`) antes del typecheck.

---

### [2026-07-21] - Bug crítico corregido + relevamiento de planillas TAPAS: "Control Peso Tapas" como punto de control propio

- **Qué se corrigió:** el usuario relevó las planillas físicas reales de planta para el producto TAPAS y encontró que el sistema no coincidía en varios puntos. El hallazgo más importante: **"Control Peso Baño Alfajor" servía DOS modos de UI (alfajor estándar y "tapitas") bajo un solo `schema_json` compartido, pero el payload del modo tapitas nunca coincidió con ese schema — 0 registros se guardaron jamás para TAPAS** (confirmado por consulta directa a la tabla `registros_calidad` antes del fix). Documentado como **ADR-016** en `docs/architecture.md` (mismo día que ADR-015 — es un hito posterior en la misma fecha).

- **Cadena de aprobación completa (sin veto, un hallazgo Alto corregido en el camino):**
  1. **`scm-alimentos` (primera ronda):** auditó 5 reglas de negocio propuestas (cálculo de cobertura por resta apareada por observación, escurrimiento opcional, `temp_interna` opcional, filtro de insumos por familia, relabel "Pico N"). Dictamen "válida con ajustes" — marcó 3 puntos como bloqueantes hasta que el usuario los definiera: (a) qué era la 3ª fila "BAÑO" del diseño viejo, (b) si `temp_interna` es un PCC del plan HACCP, (c) si hacía falta un insumo de packaging para TAPAS vendible.
  2. **Usuario respondió** (vía preguntas del agente): (a) la 3ª fila "BAÑO" no correspondía, sobra — el proceso real es 2 pesadas + resta calculada; (b) `temp_interna` **SÍ es PCC** — permanece obligatorio (se descartó la idea original de hacerlo opcional); (c) no hace falta insumo de packaging, alcanza con 2 insumos para TAPAS.
  3. **`arquitecto-industrial`:** aprobó el diseño de crear un `PuntoControl` **nuevo y separado** ("Control Peso Tapas") en vez de forzar un schema `oneOf`/condicional compartido — consistente con ADR-001 ("un punto de control = un schema_json", nunca hardcodeo condicional por familia dentro de un mismo schema). Confirmó que reutilizar los mismos `Parametro` lógicos (`peso_tapa`, `temp_bano`) con bindings nuevos por punto de control es el diseño correcto de ADR-015 (no crear parámetros duplicados por PC). Confirmó que no hacía falta migración de Prisma (todo son filas nuevas vía seed, no cambios de columnas/tablas). Puso una condición: el servidor no debe confiar ciegamente en que el cálculo de cobertura del cliente es correcto sin un chequeo mínimo de consistencia (rango razonable) — esto quedó cubierto por los límites `minimum`/`maximum` del `schema_json` del nuevo PC (mismo patrón que ya usa `peso_bano` estándar, no se agregó recálculo server-side completo).
  4. **Implementación** (backend + frontend).
  5. **`seguridad-analista`:** aprobado con observaciones, **sin veto**. Encontró un hallazgo Alto real (no hipotético — se confirmó contra la DB): el seed solo hacía `upsert` de `PuntoControlFamilia` y nunca borraba la relación vieja `pcPesoBano↔famTapas`, así que esa fila seguía viva en la base real tras correr el seed nuevo — reintroducía la ambigüedad de "2 puntos de control de peso mostrados a la vez para tapas" que había originado el bug. **Se corrigió de inmediato** agregando un `deleteMany` explícito antes del upsert (mismo patrón que ya usaba el seed para limpiar la relación de `pcFechadoEnvase`), y se confirmó por consulta directa que la fila vieja ya no existe. Otros hallazgos (Medio: sin recálculo server-side de la cobertura — aceptado como deuda conocida, mismo patrón que `peso_bano` estándar, decisión de negocio ya cubierta por el rango de scm-alimentos/arquitecto; Bajo: filtro de insumos por familia es solo de UI sin enforcement server-side, mismo patrón preexistente del resto del repo; Bajo: `lote_pt` sin `minLength`, riesgo bajo, no bloqueante).

- **Modelo de datos — filas nuevas, sin migración:**
  - **Nuevo `PuntoControl` "Control Peso Tapas"** (`tipoFormulario: peso_bano`, reutilizado — el dispatch de componente ya distingue por familia del producto activo, no hace falta nuevo enum). Su `schema_json` (`schemaPesoTapas` en `prisma/seed.ts`) requiere: `mediciones_tapa[12]` (peso tapa sin bañar), `mediciones_tapa_con_bano[12]` (peso tapa con baño), `mediciones_cobertura[12]` (calculado en el cliente por resta apareada `con_baño[i] − sin_bañar[i]`, rango de plausibilidad `[-10, 30]` — NO el rango de calidad, que vive en `EspecificacionProducto` por separado, ver ADR-001/ADR-015), `temp_ambiente`, `temp_bano`; `escurrimiento` opcional.
  - **"Control Peso Baño Alfajor" (el PC viejo)** pierde la asociación con la familia `tapas` (se corrigió con `deleteMany`, ver arriba) — vuelve a ser exclusivo de `alfajor_negro`. Su `schema_json` (`schemaPesoBano`) también pasa `escurrimiento` a opcional (antes obligatorio) — mismo criterio: no se mide en cada muestra en la práctica de planta.
  - **Nuevos parámetros de catálogo**: `peso_cobertura` (g) y `temp_interna` (°C, marcado como PCC en el comentario del seed — pendiente que el usuario cargue una `EspecificacionProducto` con `esCritico: true` cuando defina la lista completa de PCC del plan HACCP; hoy el catálogo de parámetros lo soporta pero no hay ninguna spec cargada todavía para `temp_interna`). El catálogo pasa de 13 a **15 parámetros**.
  - **Nuevos bindings** (`PuntoControlParametro`) en "Control Peso Tapas": `peso_tapa`→`mediciones_tapa` (array_cada, reusa el parámetro `peso_tapa` ya usado en "Control Peso Alfajor" con otro campoData), `peso_cobertura`→`mediciones_cobertura` (array_cada), `temp_bano`→`temp_bano` (escalar, reusa parámetro existente). Nuevo binding en "Control Temperatura Condensación Túnel": `temp_interna`→`temp_interna` (escalar). El catálogo pasa de 14 a **18 bindings**.
  - **Nuevo valor de enum** `tapas_sin_banar` en `schemaTrazabilidadInsumos` (catálogo de insumos) — la tapa cruda que entra al proceso de baño de TAPAS, distinto de `tapas_banadas` (la tapa YA bañada, insumo de ENTRADA para armar alfajores — no corresponde trazarlo al producir tapas, sería trazar la salida del propio proceso).
  - Descripción de frecuencia corregida en "Control Temperatura Condensación Túnel" ("cada 30 min" → "cada hora", cosmético).

- **Frontend:**
  - `src/lib/calidad/peso-cobertura.ts` (nuevo, con test): helper puro `calcularCoberturaPorObservacion(tapa, tapaConBano)` — resta apareada pico a pico, tolera posiciones incompletas (da `NaN` en esa posición sin romper el resto).
  - `src/components/calidad/PesoMedicionesForm.tsx`: el modo "Tapitas" se reescribió completo — 2 filas capturadas (antes 3, se eliminó la fila manual "BAÑO" que no correspondía) + 1 fila derivada (cobertura, no editable, calculada en vivo) con indicador de fuera de especificación por celda y un resumen "N valores fuera de especificación" al completar la muestra. Relabel "P1..P12" → "Pico 1..Pico 12" en los 3 formularios de peso (Alfajor, Relleno, Tapas) — cada posición es un pico dosificador físico de la máquina (confirmado por el usuario, incluido el caso "otros" de Relleno).
  - `src/components/calidad/ProduccionDiariaForm.tsx`: el campo "Peso del alfajor" ahora se oculta (y no se envía en el payload) cuando la familia del producto activo no es `alfajor_negro`. El campo "Lote PT" volvió a ser editable (en la sesión anterior se había dejado como solo-lectura, decisión que el relevamiento de planillas corrigió): default = `productoActivo.numeroLote` (sugerido, mostrado en verde), editable con override persistido en `sessionStorage` (clave `calidad:lotePt:{lineaProductivaId}:{loteId}` — el override se resetea solo si cambia el lote activo de la línea) y un botón "Usar sugerido" para volver al valor por defecto. Verificado en browser: el override sobrevive a un reload de la pestaña.
  - `src/components/calidad/TrazabilidadInsumosForm.tsx`: la lista de insumos seleccionables se filtra por `productoActivo.familiaSlug` — con TAPAS activo solo se ofrecen "Tapas Sin Bañar" y "Cobertura de Chocolate" (antes: los mismos 4 insumos de alfajor sin importar qué se estuviera produciendo). Con alfajor activo, sigue mostrando los 4 originales (uno renombrado de "Baño Chocolate" a "Cobertura de Chocolate" para alinear con el lenguaje real de planta). Filtro solo de UI, sin enforcement server-side (mismo patrón preexistente del resto del repo — documentado como deuda conocida, no bloqueante).

- **Verificación realizada:**
  - 107 tests (14 suites) verdes, typecheck limpio.
  - Verificación AISLADA (sin escribir en la DB) del punto crítico: se comparó el `schema_json` real ya sembrado contra el payload exacto que arma el nuevo código — el payload nuevo (con y sin escurrimiento) valida `true`; un payload con la forma vieja rota (con `mediciones_bano` + `familia`) sigue siendo rechazado por las razones correctas (`additionalProperties`, falta `mediciones_cobertura`).
  - Verificado en browser con Alfajor activo (no se tocó la activación de TAPAS en la línea real, para no escribir datos de negocio sin que el usuario lo pidiera): "Control Peso Baño Alfajor" sigue visible para alfajor, "Control Peso Tapas" correctamente oculto (aparece solo con familia tapas); "Peso del alfajor" sigue visible en Producción Diaria; Lote PT editable con override persistente confirmado; Trazabilidad Insumos muestra los 4 insumos originales con alfajor activo.
  - Hallazgo Alto de seguridad-analista (fila `PuntoControlFamilia` vieja no limpiada) corregido con un `deleteMany` en el seed y confirmado por consulta directa que la fila ya no existe tras re-correr el seed.

- **Pendiente para el usuario (no bloqueante, próximo paso):**
  - Activar TAPAS en Línea 3 requiere cargar `Producto.vidaUtilMeses` para ese producto desde `/calidad/maestro` (bloqueo `409 PRODUCTO_SIN_VIDA_UTIL`, ADR-013) — no se tocó ese dato porque es dato de negocio real que le corresponde al usuario cargar, no inventarlo.
  - Cargar la `EspecificacionProducto` de `peso_cobertura`/`peso_tapa`/`temp_ambiente`/`temp_bano` para el producto TAPAS real (hoy no hay ninguna spec cargada para TAPAS — el catálogo/bindings están listos, falta el dato de calidad).
  - Cargar la lista real de PCC del plan HACCP (pendiente de sesiones anteriores) para poder marcar `esCritico: true` en la spec de `temp_interna` cuando corresponda.
  - Prueba end-to-end completa de guardado real de un registro en "Control Peso Tapas" contra la DB (la verificación de esta sesión fue aislada/sin escritura, por las razones de arriba) — recomendar hacerla la primera vez que se active TAPAS con los datos de maestro completos.

---

### [2026-07-21] - Administración del maestro + especificaciones de calidad por producto (comparación medido-vs-estándar en vivo)

- **Qué se construyó:** módulo de administración del maestro (`Producto` / `Marca` / `Familia`) con alta/edición desde la app, + **especificaciones de calidad por producto** versionadas y append-only, con **comparación medido-vs-estándar en vivo** en los formularios de captura (peso, temperatura, producción diaria). Cierra dos deudas viejas de `architecture.md`: "sin pantalla de administración del maestro" y "sin auditoría append-only sobre Producto/Marca/Familia". Documentado como **ADR-015** en `docs/architecture.md` (número 014 ya estaba tomado por el pooler/DIRECT_URL — ver inconsistencia al final).
- **Cadena de aprobación completa (sin veto):** `scm-alimentos` (reglas de negocio: spec por producto × PUNTO DE CONTROL × parámetro; versionado con vigencia; tres capas de límite objetivo/aceptación/crítico; superar el crítico NO bloquea el guardado — el punto HACCP es registrar la desviación) → `arquitecto-industrial` (modelo de datos, catálogo cerrado de parámetros, binding parámetro↔campo, convivencia con schema_json de ADR-001) → `backend-senior` (repository + service en transacción, validación de ordenamiento de límites) → `frontend-ux` (UI admin + indicador en vivo) → `seguridad-analista` (aprobado con observaciones NO bloqueantes M1/B1/B2, ver deuda abajo).
- **Modelo de datos — 4 tablas nuevas** (migración `20260721170200_maestro_admin_especificaciones`):
  - `Parametro` (`parametros`): catálogo **CERRADO** de parámetros especificables (`clave` unique, `nombre`, `unidad`). Solo admin/seed agrega.
  - `PuntoControlParametro` (`puntos_control_parametros`): binding estructural (puntoControl × parámetro) → `campoData` (clave/JSON-path en `RegistroCalidad.data`) + `agregacion` enum (`escalar` / `array_cada` / `array_promedio` / `derivado`). Resuelve el mapeo parámetro↔campo sin hardcodeo. Es **estructura derivada de los schema_json**, se siembra en el seed, no es dato de negocio editable.
  - `EspecificacionProducto` (`especificaciones_producto`): spec **VERSIONADA append-only** por (producto × puntoControl × parámetro). `objetivo`, `aceptacionMin/Max`, `criticoMin/Max` (`Decimal(10,4)`), `esCritico`, `version`, `vigenteDesde/Hasta` (timestamptz), `creadoPorId`. **SIN campo `activo`** — la única verdad de vigencia es `vigenteHasta IS NULL`. Índice único **PARCIAL** `especificaciones_producto_vigente_unica WHERE vigente_hasta IS NULL` (SQL crudo en la migración, Prisma no lo expresa en el DSL): a lo sumo UNA vigente por par.
  - `AuditoriaMaestro` (`auditoria_maestro`): append-only, cubre `Producto`/`Marca`/`Familia`/`EspecificacionProducto` con snapshot antes/después + usuario, dentro de la misma transacción de cada escritura.
- **Reglas que NO hay que revertir (aprobadas por scm-alimentos + arquitecto-industrial, confirmadas por el usuario):**
  - Spec por **(producto × PUNTO DE CONTROL × parámetro)**, no solo por producto — el mismo parámetro (peso) tiene target distinto según la estación (relleno/bañado/final).
  - Versionado con vigencia: editar = **versión nueva** (cerrar la anterior + abrir la nueva en la misma transacción, mismo timestamp). La "spec vigente para un registro" se reconstruye por ventana temporal `[vigenteDesde, vigenteHasta)` contra el `createdAt` del registro. **Sin FK dura registro→spec.** Append-only estricto: correcciones = versión nueva, nunca pisar/borrar.
  - Tres capas de límite: objetivo + rango de aceptación (operativo) + límite crítico (inocuidad/PCC), min/max independientes. **Superar el crítico NO bloquea el guardado** (el punto HACCP es registrar la desviación). El **flujo formal de tratamiento de desviación de PCC (acción correctiva + firma) quedó DIFERIDO** a fase futura — el modelo ya deja el lugar con `criticoMin/Max` + `esCritico`.
  - **Convivencia con schema_json (ADR-001):** schema_json/AJV = validación estructural + cota física (gate de guardado); spec por producto = capa de objetivo de calidad, se muestra en vivo, **NO toca el gate de guardado**. NO apretar los rangos de schema_json hasta volverlos de calidad (se perderían registros de desviaciones).
  - **Unidad del parámetro: informativa**, sin enforcement de que coincida con la unidad del campo medido (schema_json no tiene metadata de unidad) — control de revisión humana.
  - `peso_baño`: agregación `derivado`, se evalúa al cierre de jornada, no medición por medición.
  - **Permisos: edición SOLO rol `admin`** (`ROLES_ADMIN_MAESTRO` en `src/lib/auth/roles.ts`).
- **Capas implementadas:** repository `src/db/maestro.repository.ts` (CRUD + `versionarEspecificacion` + auditoría en transacción + `getEspecificacionesCaptura`); service `src/services/calidad/maestro.service.ts` (Zod, validación de ordenamiento de límites crítico ⊇ aceptación ∋ objetivo, verificación de refs y binding); 7 endpoints REST de escritura (solo admin, gate compartido `src/lib/calidad/maestro-http.ts`); helper puro `src/lib/calidad/especificaciones.ts` (`evaluarValor` → dentro/fuera_aceptacion/fuera_critico/sin_spec, bordes inclusivos; `formatearRango`); UI admin `src/app/calidad/maestro/` + `src/components/calidad/maestro/*`; `IndicadorSpec.tsx` integrado en `TemperaturaForm`, `ProduccionDiariaForm`, `PesoMedicionesForm`; `EspecCampo` agregado a `ProductoActivoLinea` (poblado en el Server Component de la grilla con falla suave).
- **Lecturas por Server Component, NO por GET HTTP:** solo hay 7 endpoints de escritura (POST/PATCH). Las lecturas del admin y de la captura van directo por el repository desde Server Components — mismo criterio que el resto del repo.
- **Seed:** catálogo de **13 parámetros + 14 bindings** (estructura derivada de los schema_json existentes). **SIN backfill de specs** (rangos por producto = dato de calidad, se cargan a demanda).
- **Tests:** 99 en total (nuevos: helper `especificaciones` + `maestro.service`). Typecheck limpio. Verificado en browser: admin carga 104 productos, se guardó una spec real (Alfajor Negro peso 72–78 / crít 68–82, version 1 vigente en DB), el form de Peso Alfajor muestra "objetivo 72–78 g" y colorea las mediciones.
- **Deuda registrada por `seguridad-analista` (aprobado con observaciones, NO bloqueante):**
  - **M1 (Medio):** `auditoria_maestro` y `AuditoriaRegistro` son append-only solo a nivel aplicación; el rol de la app todavía tiene `UPDATE`/`DELETE` a nivel motor. **Antes del circuito de exportación Arcor:** `REVOKE UPDATE, DELETE` o triggers `BEFORE UPDATE/DELETE`.
  - **B1 (Bajo):** sin rate limiting en los endpoints de escritura del maestro (reusar patrón de `rate-limit-login.ts` si se agrega).
  - **B2 (Bajo):** TOCTOU benigno en `verificarRefsProducto` — una ref borrada entre el `findUnique` y el `create` da 500 (P2003) en vez de 404/409.
  - Pendientes de dato/producto: falta la **lista real de PCC del plan HACCP** para marcar `esCritico` en el seed (dato del usuario); y el **flujo de tratamiento de desviación de PCC quedó diferido**.
- **Inconsistencia código↔doc detectada al documentar y RESUELTA (2026-07-21):** el código nuevo referenciaba esta feature como "ADR-014" en comentarios, pero **014 ya estaba tomado por el pooler/DIRECT_URL** — el número correcto es **ADR-015**. Se corrigieron todos los comentarios de código y del schema. Quedan dos "ADR-014" a propósito: `src/lib/prisma.ts` (referencia legítima al pooler) y el comentario del SQL de la migración `20260721170200` (no se edita para no romper el checksum de la migración ya aplicada — es solo un comentario sin efecto funcional).

---

### [2026-07-20] - Fix (dos pasadas): Lote PT de Producción Diaria — de sugerencia rota a valor derivado sin input

- **Pasada 1 (revertida en la 2):** el usuario reportó que el "Lote PT sugerido por nomenclatura" (`L20260720-01`) estaba mal calculado, y en un primer mensaje pareció pedir carga 100% manual — se implementó así, eliminando `generarLotePT()`/`Producto.nomenclaturaLote` del flujo.
- **Corrección del usuario:** no quería carga manual — el código de Lote PT **es un estándar ya definido** por una regla existente: el mismo `Lote.numeroLote` (formato definitivo ADR-013, `L-DD/MM/AAAA-AJJJ-hh:mm-ENV`) que ya se genera al activar el producto en la línea y se muestra en el banner superior del formulario. No hace falta tipearlo ni recalcularlo — todos los pallets del día comparten ese mismo Lote.
- **Fix definitivo:** `ProduccionDiariaForm.tsx` — el campo "Lote PT" pasó de input editable a **display de solo lectura** (mismo estilo visual que "Vencimiento PT": caja verde con ícono de check) mostrando `productoActivo.numeroLote`. Se quitó `Entrada.lote_pt` (ya no es un dato por pallet) y su validación; el payload usa `productoActivo.numeroLote` directamente para los tres pallets del batch.
- **Se mantiene de la pasada 1:** `generarLotePT()` y la derivación por `Producto.nomenclaturaLote` siguen eliminados (esa parte del diagnóstico — el cálculo por template estaba mal y es un concepto distinto al Lote administrativo — seguía siendo correcta). `nomenclaturaLote` sigue dormido en el schema/maestro.
- **Lección para no repetir:** un mismo mensaje del usuario mezcló "el valor está mal" con "no lo quiero sugerido" — la primera lectura interpretó la segunda parte como "que lo tipee el operario", cuando en realidad pedía "que lo calcule bien el sistema, sin intervención". Ante ambigüedad de alcance en un pedido de UX que además toca cómo se completa un dato de trazabilidad, más vale preguntar el valor final esperado (con un ejemplo concreto) antes de implementar, no solo el alcance del cambio.
- **Verificado en browser:** el campo muestra `L-19/11/2026-6201-12:01-3` (mismo valor que el banner de línea), sin ningún `<input>` en el DOM. Typecheck y suite de tests verdes (73/73).
- **Actualización 2026-07-21 (ver hito de arriba, ADR-016):** este campo volvió a ser editable — el relevamiento de planillas físicas de TAPAS mostró que hacía falta poder declarar un lote distinto en casos puntuales. No es una reversión de la lección de esta sesión (el valor sugerido sigue siendo el correcto, calculado por el sistema); lo que cambió es que ahora se permite un override manual explícito, con el valor sugerido siempre visible y un botón para volver a él.

---

### [2026-07-20] - Formato definitivo de `Lote.numeroLote` (flujo automático) + "jornada productiva" 6am-6am

- **Contexto:** cierre de la deuda #9 de `docs/auditoria-2026-07.md` ("reglas reales de numeración de lote, hoy placeholder `GEN-{fecha}-{hora}`, las define el usuario" — pendiente desde ADR-011).
- **Nuevo formato para el flujo automático** ("producto activo por línea", ADR-012): `L-DD/MM/AAAA-AJJJ-hh:mm-ENV`. `DD/MM/AAAA` es la fecha de **vencimiento** (`fechaProducción + Producto.vidaUtilMeses`, preservando el día del mes con clamp de overflow — nueva función `calcularFechaVencimiento` en `src/lib/calidad/lote-pt.ts`, de la que `calcularVencimiento` (`MM/yyyy`, usado en Producción Diaria) ahora es un wrapper). `AJJJ` es el último dígito del año + día juliano (1-366) de la fecha de **producción**. `hh:mm` es la hora de planta (zona `America/Argentina/Cordoba`) al momento de crear el registro — **"hora de registro en sistema"**, NO hora real de inicio de producción (aclaración de `scm-alimentos`, evita falsa precisión). `ENV` es el código de línea productiva (`LineaProductiva.codigo`; valores reales hoy: 0/1/2/3). Nuevo módulo puro `src/lib/calidad/lote-numero.ts` (`generarNumeroLote`), sin dependencias de Prisma/framework.
- **Alcance acotado — decisión explícita, no deuda accidental:** el formato nuevo solo aplica cuando el lote se crea vía el flujo automático de "producto activo por línea" (tiene código de línea disponible). El alta MANUAL de lote (`/calidad/lotes/nuevo`) sigue con el placeholder legacy `GEN-{fecha}-{hora}` — no asocia línea productiva hoy, y el usuario confirmó que ese camino no ocurre en la práctica desde que existe producto-activo-por-línea (ADR-012).
- **"Jornada productiva" — corte de 24hs de 6am a 6am** (nueva función `jornadaProductiva()` en `src/lib/calidad/fecha-planta.ts`, junto a `hoyPlanta()`/`horaPlanta()`): reemplaza el día calendario en el find-or-create de `activarProductoLinea` (decide si corresponde generar un `Lote` nuevo o reusar el existente) y en la lectura vía el endpoint `GET /api/v1/lineas-productivas/[lineaId]/producto-activo` (evita que la lectura y la escritura queden desincronizadas en la franja 00:00-05:59, hallazgo de `arquitecto-industrial`). El resto del módulo (registros del día, correlativo de pallets, resolución de turno) sigue usando `hoyPlanta()` sin cambios — decisión explícita para acotar el blast radius.
- **Inconsistencia encontrada al documentar, corregida en el mismo cierre:** `src/app/calidad/[lineaId]/[puntoControlId]/page.tsx` (la grilla de puntos de control) leía el producto activo con `hoyPlanta()` en vez de `jornadaProductiva()` — un segundo punto de lectura que había quedado sin actualizar, con el mismo riesgo de desincronización 00:00-05:59 que este hito cierra. Detectado por `documentador` al escribir este hito; corregido de inmediato (mismo cambio de una línea que ya se había aplicado en el `GET` del endpoint). Typecheck + suite completa verdes tras el fix.
- **Nuevo bloqueo de negocio:** activar un producto sin `Producto.vidaUtilMeses` cargado (o con valor ≤0, dato mal cargado) en el maestro ahora se rechaza con `409 PRODUCTO_SIN_VIDA_UTIL` en vez de permitirse — decisión explícita del usuario tras confirmar con una auditoría de datos que 9/104 productos activos no tienen ese dato (2 de ellos activos el mismo día de la decisión: TAPAS en Línea 3, BIZCOCHOS en Línea 0 — se rompen en su próximo changeover hasta que se complete el maestro; aceptado a conciencia). La validación es `<= 0`, no solo `== null` (hallazgo de `seguridad-analista`: un dato mal cargado debía dar el mismo `409` claro, no un `500` genérico vía el `throw` defensivo de `calcularFechaVencimiento`).
- **Bug de timezone encontrado y corregido en el camino (lección para no repetir):** `fechaProduccion` llega a `crearLote()` parseada de un string ISO `"yyyy-MM-dd"` (vía `jornadaProductiva()`/`hoyPlanta()`) — eso la construye en UTC medianoche. Pero `calcularFechaVencimiento`/día-juliano leen con getters LOCALES (mismo criterio que el resto de `lote-pt.ts`). Mezclar ambos corre el día calendario según el desfasaje horario de la máquina que ejecuta el proceso Node — se verificó el bug real en browser (vencimiento "19/11" con día juliano "6201", que corresponde al 20, contradictorio) y afectaba TANTO el formato nuevo como el legacy `GEN-`. Fix: en `crearLote()`, se reconstruye una sola vez `fechaCalendario` con getters UTC hacia un `Date` de constructor local, ANTES de bifurcar entre el formato nuevo y el legacy — blindado con test de regresión en `src/db/calidad.repository.lote-numero.test.ts` (mockeando Prisma, sin DB real). Es el mismo patrón de fondo que el bug de `toISOString()` del hito de 2026-07-13 (ver más abajo): cualquier función que mezcle un `Date` parseado de un string ISO con getters locales corre riesgo de desalinear el día calendario según la TZ de la máquina — hay que decidir UTC o local para todo el cálculo, nunca mezclar a mitad de camino.
- **Cambios de firma:** `crearLote()` y `activarProductoLinea()` (`src/db/calidad.repository.ts`) pasaron de parámetros posicionales a objeto — decisión de `backend-senior`, para que dos `number | null` consecutivos (`vidaUtilMeses`, `lineaCodigo`) no puedan invertirse sin que TypeScript lo detecte.
- **Cadena de revisión completa:** `scm-alimentos` (auditoría de la regla de negocio, "válida con ajustes" — resolvió con el usuario el criterio de vencimiento, el corte 6am-6am, y el bloqueo por vida útil) → `arquitecto-industrial` (encontró y resolvió el problema estructural de sincronización lectura/escritura en la ventana 00:00-05:59, y el riesgo de colisión determinística por minuto) → implementación → `backend-senior` (encontró el mismo bug de timezone reproducido en el camino legacy, no corregido en la primera pasada — se corrigió) → `seguridad-analista` (aprobado con una observación menor sobre validación de `vidaUtilMeses` ≤0, ya corregida). 63 tests, typecheck limpio, verificado en browser contra Supabase real (activación con formato nuevo, bloqueo por vida útil faltante).

---

### [2026-07-16] - Producción Diaria: cajas por estándar del maestro + persistencia de línea en la sesión

- **Contexto:** dos pedidos del usuario tras probar en tablet: (1) "Cajas producidas" debe tomar por defecto el estándar `cajasPorPallet` del producto, con carga manual solo si el pallet quedó incompleto; (2) volver "atrás" desde un punto de control no debe resetear al paso de selección de línea.
- **Regla de negocio (dictamen `scm-alimentos`: "válida con ajustes"; decisiones cerradas con el usuario):**
  - Con estándar definido, el campo cajas nace precargado y **bloqueado** — la única vía de edición es marcar "¿El pallet quedó incompleto?" (limpia y abre el numpad); desmarcar restaura el estándar. Sin estándar (null en maestro): carga manual libre como antes.
  - El usuario **mantuvo el boolean** `pallet_incompleto` (rechazó el motivo de lista corta sugerido por scm) — payload sin cambios, el JSON Schema AJV ya lo soportaba, cero migración.
  - **Pallet abierto entre turnos**: cada turno registra lo suyo (el saliente marca incompleto con las cajas que lleva; el entrante arranca pallet nuevo). Es instrucción operativa, no código.
  - **Confirmación del último pallet** al guardar si quedó con el estándar sin tocar (`window.confirm`) — scm: el último pallet del turno es estadísticamente el parcial y el riesgo real es guardarlo sin mirar (balance del lote no cierra ante Arcor).
  - **Sin cota superior de cajas a propósito**: scm pidió permitir cantidades MAYORES al estándar (fin de lote suma cajas sueltas al último pallet). Solo se valida cajas > 0.
- **Persistencia de línea:** `sessionStorage` (`calidad:lineaActiva`, decisión del usuario: dura lo que la pestaña — coherente con "producto activo de hoy"). Hidratación en efecto de montaje (no en el init de `useState`: el componente se server-renderiza y leer storage ahí rompería la hydration). Prioridad `?linea=` > storage > paso "linea". Se guarda al resolver con éxito el fetch de producto-activo; se limpia con "Cambiar de Línea"/"Volver a elegir línea". Además, los 3 redirects post-guardado que perdían la línea ahora llevan `?linea=` (`useBatchGuardar` de ProduccionDiaria y los 2 handlers de PesoMedicionesForm — uno iba a `/calidad` a secas).
- **Propagación del dato:** `ProductoActivoLinea.cajasPorPallet` (tipo + mapper inline de `[puntoControlId]/page.tsx` + `toProductoActivoLinea` del route + demo). La query de Prisma ya lo traía (include completo de producto).
- **Revisión `frontend-ux` (aprobado con observaciones), correcciones aplicadas:** validación cajas > 0; `aria-disabled` en el campo bloqueado; y el hallazgo real de que el numpad (panel fijo bottom ~320px) tapaba el toggle en pantallas bajas — fix: spacer condicional (`h-[340px]` con numpad abierto) + `scrollIntoView(block:"start")` de la card al marcar incompleto, **diferido con setTimeout** para que React ya haya agrandado el spacer (verificado en browser: toggle en y=151 con panel en y=318).
- **Observación escalada al usuario (frontend-ux, no resuelta):** si el operario guarda de a un pallet por vez, la confirmación del último pallet salta en CADA guardado — fatiga que erosiona la protección. Decidir si se acota el disparador o se acepta el costo.
- `seguridad-analista` no se invocó (proporcionalidad: sin cambios de auth/authz/schema; sessionStorage guarda solo un UUID de línea no sensible; el manejo de 401 ya venía revisado del fix anterior).
- **Verificado en browser** contra dev server real: precarga 357 + "Estándar del producto"; campo no abre numpad; marcar → limpia y abre numpad (con auto-scroll); cargar 300; desmarcar → restaura 357; entrar a puntos-control sin `?linea=` restaura directo la grilla de la línea; atrás del browser desde un form vuelve a la grilla; "Cambiar de Línea" limpia el storage. La confirmación del último pallet se verificó por código (dispararla en browser habría escrito un pallet falso en la DB real).
- **Incidente de entorno (lección):** correr el preview server del agente en paralelo al dev server del usuario sobre el mismo repo corrompe `.next/` (ambos escriben la misma caché de webpack) — ChunkLoadError e hydration errors en los dos. Se resolvió matando ambos y regenerando `.next`. **No levantar un segundo `next dev` sobre el mismo working dir**; usar el server que ya está corriendo o reemplazarlo.

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

**Nota (2026-07-21):** el diseño de "modo tapitas" descripto en este hito de 2026-07-02 (fila manual "BAÑO", payload `mediciones_bano` + `familia: "tapitas"`) quedó **superado** por el hito de arriba del 2026-07-21 (ADR-016) — ese diseño nunca coincidió con el `schema_json` real sembrado y el guardado falló siempre para TAPAS. No usar este hito como referencia del comportamiento actual del modo Tapitas/TAPAS; ver el hito de 2026-07-21 y ADR-016 en `architecture.md`.
</content>
