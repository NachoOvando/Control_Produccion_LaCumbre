# API Reference — Plataforma Industrial La Cumbre

Versión de API: `v1`. Todos los paths bajo `/api/v1/`.

## Convenciones

- **Autenticación:** todos los endpoints requieren sesión NextAuth válida. Sin sesión → `401 { error: "No autorizado", code: "NO_AUTORIZADO" }`.
- **Contrato de respuesta:** éxito → `{ data }`. Error → `{ error, code }` (opcionalmente `details` en errores de validación).
- **Autorización (decisión pendiente):** hoy cualquier sesión válida puede leer registros de cualquier línea. Es aceptable mientras todos los usuarios sean internos. Antes de dar acceso a clientes de fasón o auditores externos hay que definir autorización por línea/cliente (hallazgo Medio de seguridad-analista, sin resolver a propósito — ver ADR-009 en `architecture.md`).

---

## Módulo Calidad

### GET /api/v1/calidad/lineas

Líneas productivas del módulo calidad con sus puntos de control (sin `schemaJson`).

**Respuesta 200:**
```json
{ "data": [ {
  "id": "uuid", "nombre": "...", "descripcion": "...",
  "puntosControl": [ { "id": "uuid", "nombre": "...", "descripcion": "...", "tipoFormulario": "peso_relleno", "orden": 1 } ]
} ] }
```

---

### GET /api/v1/calidad/puntos-control?lineaId={uuid}

Puntos de control de una línea, incluyendo `schemaJson` (JSON Schema del formulario), ordenados por `orden`.

| Param | Tipo | Obligatorio |
|---|---|---|
| `lineaId` | UUID (query) | Sí |

**Errores:** `400 PARAM_FALTANTE` si falta `lineaId`.

**Nota (desde ADR-016, 2026-07-21):** la Línea 3 devuelve **dos** puntos de control de peso ("Control Peso Baño Alfajor" y "Control Peso Tapas") con el mismo `orden` (3) y `tipoFormulario: "peso_bano"` — son mutuamente excluyentes por familia del producto activo (`PuntoControlFamilia`), nunca se muestran juntos en la grilla. No asumir `tipoFormulario` único por `orden` dentro de una línea. Ver ADR-016 y ADR-001 (diccionario de datos) en `architecture.md` para el `schemaJson` completo de cada uno.

---

### GET /api/v1/calidad/registros

Dos modos según los parámetros:

#### Modo 1 — Historial por línea

| Param | Tipo | Obligatorio | Default |
|---|---|---|---|
| `lineaProductivaId` | UUID | Sí | — |
| `limit` | int (máx. 200) | No | 50 |

Devuelve los últimos registros de la línea: `200 { data: RegistroCalidad[] }`.

#### Modo 2 — Registros del día por punto de control

Se activa al enviar además `puntoControlId`. Es la fuente que usan los formularios para mostrar "lo ya cargado en el día" y, transitoriamente, para derivar correlativos en cliente (ver ADR-006).

| Param | Tipo | Obligatorio | Default |
|---|---|---|---|
| `lineaProductivaId` | UUID | Sí | — |
| `puntoControlId` | UUID | Sí (activa este modo) | — |
| `fecha` | `YYYY-MM-DD` | No | Hoy en `America/Argentina/Cordoba` (no UTC: a partir de las 21:00 el día UTC ya cambió y reiniciaría correlativos en pleno turno noche) |

**Respuesta 200:** `{ data: RegistroCalidad[] }` del día indicado.

**Errores:**

| Código HTTP | `code` | Significado |
|---|---|---|
| 400 | `PARAM_FALTANTE` | Falta `lineaProductivaId` |
| 400 | `PARAM_INVALIDO` | `fecha` no cumple `YYYY-MM-DD` |
| 401 | `NO_AUTORIZADO` | Sin sesión |
| 503 | `DB_NO_DISPONIBLE` | Error de base de datos (solo modo 2). **Excepción:** si `DEMO_MODE=true`, el error de DB se responde como `200 { data: [] }` — solo para demo/desarrollo; en operación real un error de DB es incidente, no "día sin registros" (integridad HACCP). |

---

### POST /api/v1/calidad/registros

Crea un registro individual. El `responsableId` se inyecta **desde la sesión del servidor**; si el cliente lo manda, se sobrescribe (no se puede suplantar responsable).

**Body:** `RegistroCalidadInput` (validado por Zod + JSON Schema del punto de control vía AJV).

**Respuestas:** `201 { data: registro }` | `400 { error, code, details }` (validación) | `401`.

**Nota (ADR-016):** para "Control Peso Tapas", el `data` esperado es `{ mediciones_tapa[12], mediciones_tapa_con_bano[12], mediciones_cobertura[12], temp_ambiente, temp_bano, escurrimiento? }` — `mediciones_cobertura` la calcula el cliente por resta apareada (`con_baño[i] − sin_bañar[i]`, helper `calcularCoberturaPorObservacion` en `src/lib/calidad/peso-cobertura.ts`) y viaja ya calculada en el POST; el servidor solo valida cota física (`schemaJson`, rango `[-10, 30]`), sin recalcularla (deuda conocida, ver ADR-016). Es un payload **distinto** al de "Control Peso Baño Alfajor" (`{ tipo_producto, mediciones[12], temp_ambiente, temp_bano, peso_tapa?, escurrimiento? }`) — antes de ADR-016 el modo "Tapitas" del frontend armaba un payload que no coincidía con ningún `schemaJson` sembrado y **todo POST fallaba** (0 registros guardados jamás para TAPAS). Ver ADR-016 en `architecture.md`.

---

### POST /api/v1/calidad/registros/batch

Ingesta atómica de hasta 500 registros en una transacción: si uno falla, se revierten todos. `responsableId` inyectado desde sesión; `origen` fijado a `"tablet"` por el servidor.

**Body:** `RegistroCalidadInput[]` (sin `responsableId`).

**Respuestas:** `201 { data: { count } }` | `400 { error, code, details }` | `401`.

**Cambio previsto (PENDIENTE, aprobado por arquitecto-industrial):** los POST de registros dejarán de aceptar `pallet_numero` / `nroMuestra` del cliente; los correlativos se asignarán server-side (ver ADR-006 en `architecture.md`).

---

### POST /api/v1/calidad/lotes

Da de alta un `Lote` de producción manualmente. Antes de esta feature (ver ADR-011 en `architecture.md`) los lotes solo se creaban vía seed o el script de import del maestro — este es el primer punto de entrada de escritura para `Lote` desde la aplicación.

**Nota de uso (desde ADR-012):** este endpoint y la pantalla `/calidad/lotes/nuevo` que lo consume **ya no están en la navegación principal** de la app. El flujo habitual para poner en marcha una línea es `GET/POST /api/v1/lineas-productivas/[lineaId]/producto-activo` (ver abajo), que también crea lotes pero sin gate de rol y con find-or-create por línea/día. Este endpoint sigue activo como alta administrativa / back-office.

**Auth:** sesión requerida (`401 NO_AUTORIZADO` sin sesión). Rol requerido: `admin`, `jefe_planta` o `supervisor_calidad`. `operador_calidad` (y cualquier otro rol) → `403`.

**Body:**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `productoId` | `string` (UUID) | Sí | Debe corresponder a un `Producto` existente y `activo: true`. |
| `fechaProduccion` | `string` (`YYYY-MM-DD`) | Sí | |
| `notas` | `string` (máx. 1000 caracteres) | No | |

El body **nunca** acepta `numeroLote` ni `creadoPorId` del cliente — ambos se generan/asignan server-side (`numeroLote` por el repository, `creadoPorId` desde `session.user.id`, mismo criterio que `responsableId` en los endpoints de registros — ver ADR-005).

**Respuesta éxito:** `201 { data: Lote }` (incluye el `producto` relacionado).

**Errores:**

| Código HTTP | `code` | Significado |
|---|---|---|
| 400 | `JSON_INVALIDO` | El body no es JSON parseable. |
| 400 | `VALIDACION_ESTRUCTURA` | El body no cumple el schema Zod (`details` trae la lista de campos inválidos). |
| 401 | `NO_AUTORIZADO` | Sin sesión. |
| 403 | `ROL_INSUFICIENTE` | Sesión válida pero el rol no está en `admin` / `jefe_planta` / `supervisor_calidad`. |
| 404 | `PRODUCTO_NO_ENCONTRADO` | El `productoId` no existe. |
| 409 | `PRODUCTO_INACTIVO` | El producto existe pero `activo: false`. |
| 500 | `ERROR_INTERNO` | Error no esperado al crear el lote (incluye agotar los reintentos ante colisión de `numeroLote`, ver ADR-011). |

**Nota sobre `numeroLote` en la respuesta:** el formato actual (`GEN-{yyyyMMdd}-{HHmmss}`) es un placeholder temporal, acotado hoy al alta manual — ver ADR-011/ADR-013 en `architecture.md`. No usarlo como referencia estable para integraciones ni reportes a Arcor.

---

### GET /api/v1/lineas-productivas/{lineaId}/producto-activo

Devuelve el producto/lote activo de una línea **hoy** (jornada productiva 6am-6am, `hoyPlanta()`/`jornadaProductiva()` en `America/Argentina/Cordoba`, ver ADR-013). Reemplaza el `<select>` "Producto en producción" que antes se repetía en cada uno de los 8 formularios de captura de calidad — ver ADR-012 en `architecture.md`.

**Auth:** sesión requerida. Sin gate de rol — cualquier usuario autenticado puede leer.

| Param | Tipo | Obligatorio |
|---|---|---|
| `lineaId` | UUID (path) | Sí |

**Respuesta 200:** `{ data: ProductoActivoLinea | null }` — `null` si la línea no tiene producto activado hoy (o si el producto activado corresponde a una fecha anterior: el puntero no arrastra el producto de ayer).

```json
{ "data": {
  "loteId": "uuid",
  "numeroLote": "L-19/11/2026-6201-12:01-3",
  "productoId": "uuid",
  "productoNombre": "ALFAJOR NEGRO; Chocolate; LC; 40g; 24u",
  "familiaSlug": "alfajor_negro",
  "vidaUtilMeses": 6,
  "nomenclaturaLote": "LC{ddMMyy}-{correlativo}",
  "activadoPorNombre": "Juan Pérez",
  "activadoEn": "2026-07-14T09:30:15.000Z"
} }
```

**Nota (desde ADR-015):** cuando este dato se resuelve en el Server Component de la grilla de puntos de control (no en este endpoint HTTP), `ProductoActivoLinea` incluye además `especificaciones: EspecCampo[]` — las specs de calidad vigentes del producto para el punto de control en contexto, usadas por los formularios para la comparación medido-vs-estándar en vivo. Este endpoint HTTP no las incluye (el selector de producto no las necesita).

**Errores:**

| Código HTTP | `code` | Significado |
|---|---|---|
| 401 | `NO_AUTORIZADO` | Sin sesión. |

---

### POST /api/v1/lineas-productivas/{lineaId}/producto-activo

Activa o cambia el producto en producción de una línea. Internamente hace **find-or-create** de `Lote` (reutiliza el lote existente si ya se activó el mismo producto en la misma línea el mismo día; si no, crea uno nuevo con el mismo mecanismo de `POST /api/v1/calidad/lotes`), mueve el puntero `LineaProduccionEstado` y registra la activación en `LineaActivacionLog` (append-only). Ver ADR-012 en `architecture.md` para el razonamiento completo.

**Auth:** sesión requerida (`401 NO_AUTORIZADO` sin sesión). **Sin gate de rol** — a diferencia de `POST /api/v1/calidad/lotes`, cualquier usuario autenticado puede activar/cambiar el producto de su línea. Decisión consciente: activar producto es una "declaración operativa" (qué se está fabricando), no un "veredicto de calidad". La trazabilidad de quién se cubre con `activadoPorId` + `LineaActivacionLog`, no con restricción de rol.

| Param | Tipo | Obligatorio |
|---|---|---|
| `lineaId` | UUID (path) | Sí |

**Body:**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `productoId` | `string` (UUID) | Sí | Debe corresponder a un `Producto` existente y `activo: true`. |

El body **nunca** acepta `lineaProductivaId` (viene del path param), `activadoPorId` (viene de `session.user.id`) ni `fechaProduccion` (se calcula server-side con `hoyPlanta()`) — ninguno de los tres se toma del cliente aunque se envíen.

**Respuesta éxito:** `201 { data: ProductoActivoLinea }` (mismo shape que el GET).

**Errores:**

| Código HTTP | `code` | Significado |
|---|---|---|
| 400 | `JSON_INVALIDO` | El body no es JSON parseable. |
| 400 | `VALIDACION_ESTRUCTURA` | `productoId` ausente o no es UUID válido (`details` trae el detalle del campo). |
| 401 | `NO_AUTORIZADO` | Sin sesión. |
| 404 | `LINEA_NO_ENCONTRADA` | El `lineaId` del path no corresponde a ninguna `LineaProductiva`. |
| 404 | `PRODUCTO_NO_ENCONTRADO` | El `productoId` no existe. |
| 409 | `PRODUCTO_INACTIVO` | El producto existe pero `activo: false`. |
| 409 | `PRODUCTO_SIN_VIDA_UTIL` | El producto no tiene `vidaUtilMeses` cargado (o es `<= 0`) — no se puede calcular el vencimiento del `numeroLote` (ver ADR-013). **TAPAS es uno de los productos hoy sin este dato cargado — bloqueado hasta que se complete el maestro, ver ADR-016.** |
| 429 | `ACTIVACION_MUY_FRECUENTE` | El mismo usuario activó algo en esta línea hace menos de 30 segundos (cooldown). Respuesta incluye header `Retry-After` (segundos). |
| 429 | `LIMITE_ACTIVACIONES_EXCEDIDO` | El mismo usuario acumuló 5 o más activaciones en esta línea en los últimos 10 minutos. Respuesta incluye header `Retry-After` (segundos). |
| 500 | `ERROR_INTERNO` | Error no esperado al activar (incluye fallas del find-or-create de `Lote`). |

**Deuda conocida (ver ADR-012):** no se valida que `producto.lineaProductivaId` coincida con el `lineaId` del path — un operario podría activar en una línea un producto que en el maestro pertenece a otra línea. El selector de UI tampoco filtra por línea (muestra los 104 productos agrupados por familia).

---

## Maestro de productos y especificaciones (Producto / Marca / Familia / EspecificacionProducto)

Desde **ADR-015** (2026-07-21) existe un módulo de administración del maestro con endpoints de **escritura** para `Producto`, `Marca`, `Familia` y las especificaciones de calidad por producto. **Desde 2026-07-22 el maestro es un módulo top-level (hermano de Calidad):** las rutas pasaron de `/api/v1/calidad/maestro/*` a `/api/v1/maestro/*` y la página de `/calidad/maestro` a `/maestro` — ver hito del 2026-07-22 en `LOG_CONTEXTO.md`.

**Alcance y patrón (importante):**

- Solo hay **7 endpoints de escritura** (POST/PATCH). **No hay GET HTTP** de estas entidades: las lecturas del módulo admin y de la captura (catálogo de productos/marcas/familias, specs vigentes, bindings) se resuelven en **Server Components** vía `src/db/maestro.repository.ts` (`getProductosMaestro`, `getMarcas`, `getFamilias`, `getParametros`, `getBindings`, `getEspecificacionesVigentesDeProducto`, `getTodasEspecificacionesVigentes`, `getEspecificacionesCaptura`, `getHistorialEspecificacion`) — mismo criterio que el resto del repo, sin ruta HTTP intermedia para lectura.
- **Todos los endpoints requieren rol `admin`** (constante `ROLES_ADMIN_MAESTRO` en `src/lib/auth/roles.ts`, compartida por las 7 rutas vía el gate común `src/lib/calidad/maestro-http.ts`). El maestro es configuración crítica de trazabilidad de exportación → solo `admin` edita; el resto de roles solo consulta (vía Server Component).
- Los `Parametro` (catálogo cerrado de parámetros especificables) y los `PuntoControlParametro` (bindings parámetro↔campo de `data`) **no tienen endpoint de escritura**: se siembran en el seed como estructura derivada de los `schema_json`, no son dato de negocio editable por el admin. **Desde ADR-016, el catálogo tiene 15 parámetros y 18 bindings** (se sumaron `peso_cobertura` y `temp_interna`, y sus bindings con "Control Peso Tapas"/"Control Temperatura Condensación Túnel").

**Códigos de error transversales a los 7 endpoints:**

| Código HTTP | `code` | Significado |
|---|---|---|
| 400 | `JSON_INVALIDO` | El body no es JSON parseable. |
| 400 | `VALIDACION_ESTRUCTURA` | El body no cumple el schema Zod (`details` trae la lista de campos/mensajes inválidos). |
| 401 | `NO_AUTORIZADO` | Sin sesión. |
| 403 | `ROL_INSUFICIENTE` | Sesión válida pero el rol no es `admin`. |
| 409 | `DUPLICADO` | Choca con un valor único (`nombre`/`sku`/`slug` ya existente). |
| 500 | `ERROR_INTERNO` | Error no esperado (los detalles se loguean server-side, no se filtran al cliente). |

Cada endpoint agrega sus códigos específicos abajo.

---

### POST /api/v1/maestro/productos

Alta de producto. Auditada en `auditoria_maestro` (append-only) dentro de la misma transacción.

**Body** (validado por Zod; numéricos no negativos y nullable salvo donde se indique):

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | `string` (máx. 300) | Sí | Descripción estándar completa — clave única. |
| `familiaId` | `string` (UUID) | Sí | |
| `marcaId` | `string` (UUID) | Sí | |
| `sku` | `string` (máx. 60) \| `null` | No | No se inventa código; `null` explícito válido. |
| `lineaProductivaId` | `string` (UUID) \| `null` | No | |
| `gusto` | `string` \| `null` | No | |
| `pesoGramos`, `unidadesPorCaja`, `rendimientoTeorico`, `pesoMasaCrudaG` | `number` (≥ 0) \| `null` | No | |
| `unidadRendimiento` | `"unidades_hora"` \| `"cajas_amasijo"` \| `null` | No | |
| `cajasPorPallet` | `int` (≥ 0) \| `null` | No | |
| `vidaUtilMeses` | `int` (> 0) \| `null` | No | Positivo estricto (ver bloqueo de activación, ADR-013). |
| `esSemielaborado` | `boolean` | No | |
| `observaciones` | `string` (máx. 2000) \| `null` | No | |
| `activo` | `boolean` | No | |

**Respuesta éxito:** `201 { data: Producto }`.

**Errores específicos:** `404 FAMILIA_NO_ENCONTRADA`, `404 MARCA_NO_ENCONTRADA`, `404 LINEA_NO_ENCONTRADA` (cualquier ref del body que no exista — se verifica antes de escribir). `409 DUPLICADO` (nombre/sku ya usado).

---

### PATCH /api/v1/maestro/productos/{id}

Edición parcial de producto (todos los campos del POST son opcionales acá). Audita snapshot antes/después.

| Param | Tipo | Obligatorio |
|---|---|---|
| `id` | UUID (path) | Sí |

**Respuesta éxito:** `200 { data: Producto }`.

**Errores específicos:** `400 VALIDACION_ESTRUCTURA` (si `id` no es UUID), `404 NO_ENCONTRADO` (el producto no existe), `404 FAMILIA_NO_ENCONTRADA` / `404 MARCA_NO_ENCONTRADA` / `404 LINEA_NO_ENCONTRADA` (solo se verifican las refs que vengan en el payload), `409 DUPLICADO`.

---

### POST /api/v1/maestro/marcas

Alta de marca. Auditada.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | `string` (máx. 120) | Sí | Único. |
| `lineaNegocio` | `"marca_propia"` \| `"copacker_arcor"` \| `"fason_terceros"` | Sí | Define la línea de negocio del producto (ver ADR-010). |

**Respuesta éxito:** `201 { data: Marca }`. **Errores específicos:** `409 DUPLICADO`.

---

### PATCH /api/v1/maestro/marcas/{id}

Edición parcial (`nombre?`, `lineaNegocio?`, `activa?`). Audita snapshot antes/después.

| Param | Tipo | Obligatorio |
|---|---|---|
| `id` | UUID (path) | Sí |

**Respuesta éxito:** `200 { data: Marca }`. **Errores específicos:** `400 VALIDACION_ESTRUCTURA` (id no UUID), `404 NO_ENCONTRADO`, `409 DUPLICADO`.

---

### POST /api/v1/maestro/familias

Alta de familia. Auditada.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `slug` | `string` (máx. 60) | Sí | Solo minúsculas, números y guión bajo (`^[a-z0-9_]+$`). Clave de UI y dispatch de formularios. |
| `nombre` | `string` (máx. 120) | Sí | Único. |

**Respuesta éxito:** `201 { data: Familia }`. **Errores específicos:** `409 DUPLICADO`.

---

### PATCH /api/v1/maestro/familias/{id}

Edición parcial (`slug?`, `nombre?`, `activa?`). Audita snapshot antes/después.

| Param | Tipo | Obligatorio |
|---|---|---|
| `id` | UUID (path) | Sí |

**Respuesta éxito:** `200 { data: Familia }`. **Errores específicos:** `400 VALIDACION_ESTRUCTURA` (id no UUID), `404 NO_ENCONTRADO`, `409 DUPLICADO`.

---

### POST /api/v1/maestro/especificaciones

Crea o **versiona** una especificación de calidad para un `(producto × punto de control × parámetro)`. Editar **no pisa**: cierra la versión vigente (`vigenteHasta = T`) y abre una nueva (`vigenteDesde = T`, `version + 1`) en la misma transacción y con el mismo timestamp. Todo append-only, auditado en `auditoria_maestro`. Ver ADR-015.

**Body:**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `productoId` | `string` (UUID) | Sí | |
| `puntoControlId` | `string` (UUID) | Sí | |
| `parametroId` | `string` (UUID) | Sí | |
| `objetivo` | `number` \| `null` | No | Valor objetivo. |
| `aceptacionMin`, `aceptacionMax` | `number` \| `null` | No | Rango operativo/de calidad (min y max independientes). |
| `criticoMin`, `criticoMax` | `number` \| `null` | No | Límite de inocuidad/PCC (envolvente externo). |
| `esCritico` | `boolean` (default `false`) | No | Marca PCC. |

**Reglas de validación (Zod `superRefine`):** al menos un objetivo o límite; `min <= max` en cada par; el rango de aceptación queda **dentro** del crítico (`criticoMin <= aceptacionMin`, `aceptacionMax <= criticoMax`); el objetivo queda **dentro** del rango de aceptación. Violarlas → `400 VALIDACION_ESTRUCTURA`.

**Respuesta éxito:** `201 { data: EspecificacionProducto }` (la versión nueva, vigente).

**Errores específicos:**

| Código HTTP | `code` | Significado |
|---|---|---|
| 404 | `PRODUCTO_NO_ENCONTRADO` | El `productoId` no existe. |
| 409 | `BINDING_INEXISTENTE` | No hay binding `(puntoControl × parámetro)`: ese parámetro no es medible en ese punto de control, así que no puede tener spec ahí. |
| 409 | `CONFLICTO_CONCURRENCIA` | Dos versionados concurrentes de la misma spec chocaron contra el índice único parcial de "una sola vigente" (carrera benigna — el cliente reintenta/refresca). |

**Nota:** no hay endpoint de baja de spec vía HTTP. El repository tiene `cerrarEspecificacion` (cierra la vigente sin abrir otra, dejando el par sin spec vigente), pero hoy no está expuesto por ningún endpoint.
</content>
