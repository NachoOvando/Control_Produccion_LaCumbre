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

**Nota sobre `numeroLote` en la respuesta:** el formato actual (`GEN-{yyyyMMdd}-{HHmmss}`) es un placeholder temporal — ver ADR-011 en `architecture.md`. No usarlo como referencia estable para integraciones ni reportes a Arcor.

---

### GET /api/v1/lineas-productivas/{lineaId}/producto-activo

Devuelve el producto/lote activo de una línea **hoy** (en `America/Argentina/Cordoba`, ver `hoyPlanta()`). Reemplaza el `<select>` "Producto en producción" que antes se repetía en cada uno de los 8 formularios de captura de calidad — ver ADR-012 en `architecture.md`.

**Auth:** sesión requerida. Sin gate de rol — cualquier usuario autenticado puede leer.

| Param | Tipo | Obligatorio |
|---|---|---|
| `lineaId` | UUID (path) | Sí |

**Respuesta 200:** `{ data: ProductoActivoLinea | null }` — `null` si la línea no tiene producto activado hoy (o si el producto activado corresponde a una fecha anterior: el puntero no arrastra el producto de ayer).

```json
{ "data": {
  "loteId": "uuid",
  "numeroLote": "GEN-20260714-093015",
  "productoId": "uuid",
  "productoNombre": "ALFAJOR NEGRO; Chocolate; LC; 40g; 24u",
  "vidaUtilMeses": 6,
  "nomenclaturaLote": "LC{ddMMyy}-{correlativo}",
  "activadoPorNombre": "Juan Pérez",
  "activadoEn": "2026-07-14T09:30:15.000Z"
} }
```

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
| 429 | `ACTIVACION_MUY_FRECUENTE` | El mismo usuario activó algo en esta línea hace menos de 30 segundos (cooldown). Respuesta incluye header `Retry-After` (segundos). |
| 429 | `LIMITE_ACTIVACIONES_EXCEDIDO` | El mismo usuario acumuló 5 o más activaciones en esta línea en los últimos 10 minutos. Respuesta incluye header `Retry-After` (segundos). |
| 500 | `ERROR_INTERNO` | Error no esperado al activar (incluye fallas del find-or-create de `Lote`). |

**Deuda conocida (ver ADR-012):** no se valida que `producto.lineaProductivaId` coincida con el `lineaId` del path — un operario podría activar en una línea un producto que en el maestro pertenece a otra línea. El selector de UI tampoco filtra por línea (muestra los 104 productos agrupados por familia).

---

## Maestro de productos (Producto / Marca / Familia) — sin API de escritura todavía

No existe ningún endpoint bajo `/api/v1/` para **escribir** `Producto`, `Marca` o `Familia`. Hoy:

- Las **lecturas** que necesita el módulo Calidad (lotes activos con su producto, familia y marca; productos activos para el selector de Alta de Lote y para el selector de activación por línea) pasan por `src/db/calidad.repository.ts` (`getLotesActivos`, `getProductosActivos`), consumidas directamente desde Server Components — no hay ruta HTTP intermedia.
- La **escritura** de `Producto`/`Marca`/`Familia` es exclusivamente vía el script `scripts/import-maestro-productos.ts` (`npm run db:import-productos`, ver `architecture.md`, sección "Operación — Import del maestro de productos"). No hay UI ni API para altas/ediciones manuales de estas tres entidades.
- **Excepción, desde ADR-011:** `Lote` (que referencia a `Producto`) sí tiene alta manual vía UI + API — ver `POST /api/v1/calidad/lotes` arriba. Desde ADR-012, además, `Lote` se crea (o reutiliza) también a través de `POST /api/v1/lineas-productivas/{lineaId}/producto-activo`. `Lote` es la única entidad del maestro/producción con escritura habilitada desde la aplicación hasta ahora — `Producto`, `Marca` y `Familia` en sí mismos siguen sin API de escritura.

Esto es un hueco de documentación consistente con un hueco real de funcionalidad (ver "Deuda técnica y decisiones pendientes" en `architecture.md`): si se construye una pantalla de administración del maestro, esta sección se actualiza con los endpoints correspondientes.
