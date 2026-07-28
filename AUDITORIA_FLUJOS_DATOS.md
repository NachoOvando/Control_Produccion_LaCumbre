# Auditoría integral de flujos de datos (CRUD)

**Fecha:** 2026-07-27 · **Commit auditado:** `b528e98` · **Alcance:** `src/`,
`prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`, `scripts/`

**Método:** verificación estática línea por línea; `npm run test` / `typecheck` /
`lint` / `audit`; y sondas de ejecución contra la DB real
(`db.rhobpqducuyufbtppbiu`) **por caminos que no persisten** — barrido de los 14
endpoints sin sesión, ejercicio del service layer con `loteId` inexistente (para que
Zod y AJV corran completos y la escritura muera en la FK), y una prueba del camino
de escritura del batch dentro de una transacción con `throw` forzado.
`registros_calidad` tenía **0 filas antes y 0 después**.

**Revisado por:** `backend-senior` (validez técnica) y `seguridad-analista`
(**veto activo**, ver §4). Los hallazgos que esos agentes marcaron como falsos
positivos se re-verificaron uno por uno; el resultado está en §6.

---

## 1. Resumen ejecutivo

El código de negocio está mejor construido de lo que sugiere su historial de bugs.
**La matriz payload ↔ Zod ↔ AJV está sana: los 11 puntos de control activos validan
sin error con su payload real**, y el camino de escritura del batch commitea
correctamente de punta a punta (verificado con rollback forzado). Eso cierra el
pendiente #0 de `PROGRESO`: el fix de `multipleOf` (`3950865`) resolvió
efectivamente la clase de bug que dejaba formularios guardando cero registros.

El problema no está donde el historial hacía mirar. Está en **autenticación e
infraestructura**, y hay tres hallazgos críticos con veto de `seguridad-analista`:
las seis cuentas del seed —dos `admin`— siguen teniendo en la Supabase real las
contraseñas literales del repositorio; el `AUTH_SECRET` que firma las sesiones es
una passphrase de baja entropía; y hay vulnerabilidades críticas sin parchear en
`@auth/core`/`next-auth`, con `npm audit` nunca ejecutado.

Debajo de eso, dos fallos reales de integridad de datos: **el alta individual de
registro no escribe fila de auditoría** (el batch sí), y **el append-only HACCP es
una convención del código, no una restricción del motor** — hay evidencia en la
propia base de que alguien borró filas por SQL sin que quede rastro.

| | Crítico | Alta | Media | Baja |
|---|---|---|---|---|
| Hallazgos | 3 | 4 | 10 | 7 |

---

## 2. Estado por entidad y flujo

`OK` · `⚠` advertencia · `✖` bug crítico · `—` no expuesto (por diseño o por omisión)

| Entidad | Carga | Lectura | Modificación | Borrado |
|---|---|---|---|---|
| `Usuario` | — (solo seed) | OK | — | — · **C1** |
| `Turno` | — (solo seed) | ⚠ B1 | — | — |
| `Marca` | OK | OK | ⚠ M9 | — (flag `activa`, sin efecto real → M9) |
| `Familia` | OK | OK | ⚠ M9 | — (flag `activa`, sin efecto real → M9) |
| `Producto` | OK | OK | ⚠ M10 | — (baja lógica por `activo`, sin confirmación en UI) |
| `EspecificacionProducto` | OK | OK | OK (versiona) | — (`cerrarEspecificacion` existe sin ruta) |
| `Lote` | OK | OK | — | — |
| `LineaProduccionEstado` | ✖ A3 | ⚠ A4 | ✖ A3 | — |
| `LineaActivacionLog` | ✖ A3 | OK | — | — (append-only) |
| `RegistroCalidad` (batch) | OK | ⚠ A4 | — | ⚠ M6 |
| `RegistroCalidad` (individual) | ✖ A2 | ⚠ A4 | — | ⚠ M6 (`softDeleteRegistro` existe sin ruta) |
| `AuditoriaRegistro` | ✖ A2 | — | — | ⚠ M6 (append-only solo por convención) |
| `LoteEstadoLog` | ✖ M7 | — | — | — |
| `SecuenciaDiaria` | ⚠ M8 | — | interno | — |
| `LineaProductiva` | — (solo seed) | ⚠ A4 | — | — |
| `PuntoControl` | — (solo seed) | ⚠ A4 | — | — |
| `PuntoControlLinea` / `Familia` / `Parametro` | — (solo seed) | ⚠ A4 | — | — |
| `Parametro` | — (solo seed) | OK | — | — |
| `AuditoriaMaestro` | OK | — | — | ⚠ M6 |
| `OrdenProduccion` | — | — | — | — (0 filas, modelo sin uso) |
| `Ubicacion` | — | — | — | — (0 filas, modelo sin uso) |
| `Account` / `Session` | NextAuth | NextAuth | NextAuth | Cascade |

**No existe ni un endpoint `DELETE` ni un `PUT` en todo el proyecto.** El borrado
físico solo aparece en `prisma/seed.ts:923,934` (limpieza idempotente de tablas
puente). Es coherente con la naturaleza append-only de un registro HACCP, pero
tiene una consecuencia operativa concreta: **un registro cargado por error no se
puede corregir ni retirar desde la aplicación**, y la función que lo haría
(`softDeleteRegistro`, `calidad.repository.ts:370`) está escrita y sin cablear.

### Estado real de la base (sonda 2026-07-27)

| Tabla | Filas | Lectura |
|---|---|---|
| `productos` | 106 | maestro cargado; **0 activos sin `vidaUtilMeses`** → el pendiente #1 de `PROGRESO` ya está resuelto |
| `especificaciones_producto` | 1 | solo `peso_alfajor` de un producto; pendientes #2 y #3 de `PROGRESO` siguen abiertos |
| `lotes` | 15 | 3 con puntero de línea activo, 12 históricos (normal) |
| `registros_calidad` | **0** | el sistema nunca persistió un registro de calidad |
| `auditoria_registros` | 0 | consecuencia de la anterior |
| `secuencias_diarias` | 2 | ambas con `ultimo_valor=1` y **0 registros asociados** → ver M6 y M8 |
| `lote_estado_log` | 0 | la máquina de estados de lote no existe → ver M7 |
| `usuarios` | 6 | todos activos, 2 con rol `admin` → ver C1 |
| `ordenes_produccion`, `ubicaciones` | 0 | modelos definidos sin ningún flujo que los use |

---

## 3. Matriz payload ↔ Zod ↔ AJV

Envoltura común (`RegistroInputSchema`, `registro.service.ts:26-38`): UUIDs,
`fecha` `YYYY-MM-DD`, `hora` `HH:mm(:ss)`, `nroMuestra >= 1`, `notas <= 1000`.
Todos los `schema_json` usan `additionalProperties: false`.

**Resultado de la sonda** — payload real de cada formulario, con decimales al borde
de `multipleOf`, contra el `schema_json` vivo en la DB:

| Punto de control | `required` en DB | Formulario | Veredicto |
|---|---|---|---|
| Control Peso Alfajor | `tipo, mediciones` | `PesoMedicionesForm` | ✅ pasa |
| Control Peso Relleno | `tipo_relleno, mediciones` | `PesoMedicionesForm` | ✅ pasa |
| Control Peso Baño Alfajor | `tipo_producto, mediciones, temp_ambiente, temp_bano` | `PesoMedicionesForm` | ✅ pasa |
| Control Peso Tapas | `mediciones_tapa, mediciones_tapa_con_bano, mediciones_cobertura, temp_ambiente, temp_bano` | `PesoMedicionesForm` (modo tapas) | ✅ pasa — incluida la cobertura por resta flotante sin redondear (`peso-cobertura.ts:18`), que `multipleOfPrecision: 9` absorbe |
| Control Temperatura Condensación Túnel | 8 campos | `TemperaturaForm` | ✅ pasa — los 8 `requerido: true` del cliente (`TemperaturaForm.tsx:37-44`) coinciden 1:1 |
| Control Temperatura Tanques | `temp_ddl` | `TemperaturaForm` | ✅ pasa — paridad correcta (solo `temp_ddl` requerido en ambos lados) |
| Detector de Metales (PCC1) | 5 campos | `DetectorMetalesForm` | ✅ pasa (cliente más estricto: exige `acciones` ante NC, el schema no) |
| Producción Diaria — Línea 3 | `cajas, lote_pt, vencimiento_pt` | `ProduccionDiariaForm` | ✅ pasa con `vencimiento_pt = "01/2027"` |
| Trazabilidad Insumos | `insumo, lote_insumo` | `TrazabilidadInsumosForm` | ✅ pasa |
| Defectos de Conformado | 5 campos | `DefectosConformadoForm` | ✅ pasa con `peso_neto = 78.5` |
| Inspección Visual Masa | 4 campos | `RegistroGenericoForm` | ✅ pasa |
| Control Fechado de Envase | 8 campos | `RegistroGenericoForm` | `PUNTO_CONTROL_INACTIVO` (`activo: false` por seed — correcto) |

**Casos negativos, todos rechazados con el mensaje correcto:**

| Caso | Código | Detalle devuelto |
|---|---|---|
| `peso_neto: 55` (fuera de 60-100) | `VALIDACION_DATOS` | `Campo 'peso_neto': must be >= 60` |
| `peso_neto: null` | `VALIDACION_DATOS` | `Campo 'peso_neto': must be number` |
| `vencimiento_pt: "01/01/27"` | `VALIDACION_DATOS` | `must match pattern "^\d{2}/\d{4}$"` |
| campo inventado | `VALIDACION_DATOS` | `Campo 'raíz': must NOT have additional properties` |
| `NaN` serializado (de un `parseFloat("")`) | `VALIDACION_DATOS` | `Campo 'temp_ddl': must be number` |
| `lineaProductivaId: "no-es-uuid"` | `VALIDACION_ESTRUCTURA` | `lineaProductivaId debe ser UUID` |
| body array en vez de objeto | `VALIDACION_ESTRUCTURA` | `expected object, received array` |
| `responsableId` suplantado | ignorado | el servidor lo pisa con la sesión ✅ |
| batch no-array / vacío / 501 items | `FORMATO_INVALIDO` / `ARRAY_VACIO` / `BATCH_DEMASIADO_GRANDE` | ✅ |

**Camino de escritura del batch — verificado.** Se replicó el shape exacto de
`createRegistrosBatchDB` (`calidad.repository.ts:506-539`) dentro de una transacción
terminada con `throw`: `siguienteValorSecuencia`, `registroCalidad.create` y
`auditoriaRegistro.create` pasan; el `datosDespues: data as object` con campos `Date`
se serializa a ISO sin error (`"2026-07-14T00:00:00.000Z"`). Conteos idénticos antes
y después. **El batch commitearía.**

**Divergencias cliente↔servidor que no producen 400 pero sí UX pobre** (el cliente
no bloquea y el server rechaza con mensaje agregado): rango de `peso_neto`
(`DefectosConformadoForm.tsx:380-386` solo verifica no-null; `min/max/step` del
input son atributos HTML sin `form` que los fuerce), formato de `vencimiento_pt`
manual (`ProduccionDiariaForm.tsx:174` solo exige no vacío) y los `required` del
schema en `RegistroGenericoForm.tsx:50-81` (marca con `*` pero no bloquea).

---

## 4. Hallazgos CRÍTICOS — veto de `seguridad-analista`

> Mientras C1, C2 y C3 sigan abiertos, **ninguna tarea relacionada se da por
> cerrada**. Los tres tocan el mismo sistema (autenticación) y conviene resolverlos
> en una sola ventana coordinada.

---

**C1 — Las contraseñas del seed siguen vigentes en la base real, incluidas dos cuentas `admin`**
`prisma/seed.ts:643` (`bcrypt.hash("password123", 12)`) y `prisma/seed.ts:670`
(`bcrypt.hash("lacumbre", 12)`).

Verificado por `bcrypt.compare` contra los hashes de la Supabase de producción:

| Cuenta | Rol | Password del repo vigente |
|---|---|---|
| `admin@lacumbre.com.ar` | `admin` | **sí** |
| `iovando@lacumbre.com.ar` | `admin` | **sí** |
| `supervisor.calidad@lacumbre.com.ar` | `supervisor_calidad` | **sí** |
| `operador.calidad@lacumbre.com.ar` | `operador_calidad` | **sí** |
| `jefe.planta@lacumbre.com.ar` | `jefe_planta` | **sí** |
| `gerencia@lacumbre.com.ar` | `gerencia` | **sí** |

Cualquiera con acceso al repositorio entra como `admin` y puede escribir el maestro
completo, especificaciones de calidad de exportación Arcor incluidas. El
`rate-limit-login` no ayuda: no hay que adivinar nada.

*Parche:*
1. **Fuera del código, primero:** rotar las 6 contraseñas en la DB y desactivar
   (`activo: false`) las cuentas de demostración que no correspondan a personas
   reales. Hacerlo en la misma ventana que C2 — rotar el secreto invalida todas las
   sesiones vivas, que es exactamente lo que se quiere después de esto.
2. Que el seed no invente contraseñas — `prisma/seed.ts:643` y `:670`:
   ```ts
   const seedPassword = process.env.SEED_USER_PASSWORD;
   if (!seedPassword) throw new Error("SEED_USER_PASSWORD no está definida — el seed no inventa contraseñas");
   const passwordHash = await bcrypt.hash(seedPassword, 12);
   ```
3. `passwordDebeCambiarse Boolean @default(true)` en `Usuario`, forzando el cambio en
   el primer login. Es un cambio de modelo de datos: pasa por
   `arquitecto-industrial` antes de tocarlo.

---

**C2 — `AUTH_SECRET` es una passphrase de baja entropía, no un secreto aleatorio**
`.env.local`.

Sin exponer el valor: 33 caracteres, **dos clases de caracteres** (minúsculas y
guiones), cinco segmentos separados por guión, varios de ellos palabras derivadas
del nombre del propio proyecto. No es la salida de un generador aleatorio.

NextAuth deriva de ese valor (HKDF) la clave que cifra y firma los JWE de sesión.
**Vector:** cualquier usuario logueado ya tiene en su navegador una cookie firmada
con ese secreto; puede llevársela y hacer fuerza bruta offline. Con segmentos de
diccionario en español eso es horas, no eternidad. Recuperado el secreto, se forja
un JWT con `rol: "admin"` y el `id` de cualquier usuario → bypass total de
autenticación y escalamiento de privilegios.

Esto es más grave que C1 en un sentido: C1 se tapa rotando contraseñas, pero
mientras el secreto de firma sea adivinable **las contraseñas dan igual**.

*Parche:* regenerar con aleatoriedad real (≥256 bits) y rotar junto con C1:
```bash
openssl rand -base64 32
```

---

**C3 — Vulnerabilidades críticas sin parchear en `@auth/core` / `next-auth`; `npm audit` nunca se corrió**
`package.json` — `next-auth@5.0.0-beta.31`, que depende de `@auth/core <= 0.41.2`.

`npm audit`, ejecutado por primera vez en esta auditoría, reporta **critical** en
`@auth/core` con tres advisories, dos de ellos directamente relevantes al diseño de
este proyecto:

| Advisory | Qué es | Por qué importa acá |
|---|---|---|
| `GHSA-7rqj-j65f-68wh` | el normalizador de email valida **antes** de la normalización Unicode → bypass por homóglifo de `@` | el email es la clave del lookup **y** del rate-limit (`auth.ts:89`, `rate-limit-login.ts`); un homóglifo evade el bloqueo de 5 intentos y potencialmente resuelve a otra cuenta |
| `GHSA-xmf8-cvqr-rfgj` | `getToken()` lanza excepción no capturada ante un header `Authorization: Bearer` malformado | DoS trivial y, combinado con A4, respuestas sin contrato |
| `GHSA-x445-f3h2-j279` | cookies de `state`/`nonce`/PKCE no ligadas al provider que las creó | hoy no aplica (solo provider `credentials`), sí el día que se agregue SSO |

`fix available via npm audit fix`, sin breaking change.

Además, `next@14.2.35` arrastra **high** con 17 advisories, entre ellas **SSRF**
(`GHSA-c4j6-fc7j-m34r`, WebSocket upgrades; `GHSA-89xv-2m56-2m9x`, Server Actions).
Esto importa específicamente para el objetivo IT/OT de `CLAUDE.md`: una SSRF en la
app de negocio es el pivote clásico IT→OT el día que exista cualquier ruta hacia la
red de planta. También `fast-uri` (high), `brace-expansion` (high) y
`@prisma/dev` → `@hono/node-server` (moderate, solo tooling de desarrollo).

*Parche:* `npm audit fix` (sube `@auth/core`/`next-auth` a la versión parcheada) y
volver a correr los 110 tests. El salto de `next@14` a `16` es breaking: va por
`arquitecto-industrial`, no acá.

---

## 5. Hallazgos por severidad

### ALTA

---

**A1 — El entorno de desarrollo apunta a la base de producción, con modo demo activo**
`.env.local`.

`DATABASE_URL` apunta a la Supabase real y, en el mismo archivo, `DEMO_MODE=true`
con `DEMO_USER_EMAIL` = la cuenta `admin` de la persona real. No hay segregación de
entornos: **cualquier cosa que corra en esta máquina en modo dev escribe en
producción**, y el login demo es una segunda contraseña válida contra la base real
para la cuenta de mayor privilegio.

El guard de boot de `auth.ts:17-21` es correcto pero **no cubre este escenario**:
solo dispara si `NODE_ENV === "production"`. En esta laptop `NODE_ENV` no es
production, así que el guard no salta, la rama demo de `authorize`
(`auth.ts:100-135`) queda activa, y está enchufada a la base real. El guard protege
el deploy en Vercel; no protege el caso que efectivamente existe hoy.

*Parche:* base de staging separada de producción; `DEMO_MODE=false` mientras
`DATABASE_URL` apunte a prod; y endurecer el guard para que también aborte si
`DEMO_MODE=true` **y** `DATABASE_URL` resuelve al host de producción, sin depender
solo de `NODE_ENV`.

---

**A2 — El alta individual de registro no escribe fila de auditoría; el batch sí**
`src/db/calidad.repository.ts:427-460` vs. `:529-538`.

`createRegistrosBatchDB` inserta un `AuditoriaRegistro` (`accion: "crear"`) por
registro, en la misma transacción. `createRegistroCalidad` inserta **solo** el
`RegistroCalidad`. El comentario de la sección (`:344-346`) declara la tabla como el
rastro append-only HACCP, y `registrarAuditoria` (`:348`) existe sin ningún
call-site.

Camino afectado: `POST /api/v1/calidad/registros` → `RegistroGenericoForm`, que hoy
sirve *Inspección Visual Masa* y *Control Fechado de Envase*, y sería el camino de
cualquier punto de control nuevo sin formulario dedicado.

**Escenario de falla:** auditoría de Arcor pide el rastro de un registro de
Inspección Visual Masa; `auditoria_registros` no tiene la fila y no hay forma de
demostrar autoría más allá de `responsableId` en la propia fila mutable.

*Parche:* mover la escritura de auditoría dentro de la misma transacción, igual que
el batch (el shape está verificado: Prisma serializa los `Date` a ISO sin problema).
En `createRegistroCalidad`, después del `create`:
```ts
const registro = await tx.registroCalidad.create({ /* ... */ });
await tx.auditoriaRegistro.create({
  data: {
    registroCalidadId: registro.id,
    accion: "crear",
    usuarioId: input.responsableId,
    datosDespues: data as object,
    ipOrigen: input.ipOrigen ?? null,
  },
});
return registro;
```
Y de paso: o se borra `registrarAuditoria`, o se refactoriza para recibir `tx` — tal
como está (escribe con el `prisma` global, fuera de transacción) es una invitación a
romper la atomicidad que este mismo hallazgo reclama.

---

**A3 — `activarProductoLinea`: el lote se crea fuera de la transacción que mueve el puntero**
`src/db/calidad.repository.ts:267-303`.

El `findUnique` (`:267`) y el `crearLote` (`:271`) usan el `prisma` global; solo el
par *upsert del puntero + `LineaActivacionLog`* está en `$transaction`
(`:290-303`).

**Escenario de falla:** el `$transaction` de `:290` falla (timeout de la única
conexión del pool, ver A4). Queda un `Lote` con `numeroLote` consumido, sin puntero
de línea y sin entrada en `LineaActivacionLog`. El operario reintenta, el
`findUnique` lo encuentra y lo reutiliza — no hay corrupción visible, pero el
`numeroLote` quedó emitido con una hora que ya no corresponde al changeover real, y
el log append-only de activaciones perdió el evento.

*Parche —* **ojo con el retry**: `crearLote` lleva adentro un loop de reintento ante
P2002 (`:184-216`). Dentro de una transacción Postgres, el primer P2002 deja la tx
abortada y el `continue` reintenta sobre una conexión muerta: el operario vería
`25P02 current transaction is aborted`, no el error real. El retry tiene que
envolver la **transacción completa**:
```ts
async function conReintentoColision<T>(fn: (sufijo?: string) => Promise<T>, intentos = 3): Promise<T> {
  for (let i = 0; i < intentos; i++) {
    try { return await fn(i > 0 ? `-${String(i + 1).padStart(2, "0")}` : undefined); }
    catch (e) { if (i === intentos - 1 || !esColisionNumeroLote(e)) throw e; }
  }
  throw new Error("inalcanzable");
}
```
con `crearLote` recibiendo el `sufijo` desde afuera (sin loop interno) y un `tx`, y
todo el cuerpo —find-or-create, upsert, log— dentro de un solo `$transaction`.
Considerar que esto alarga la ventana transaccional sobre un pool de una conexión:
va junto con A4, no antes.

> El segundo modo de falla que se consideró —dos activaciones concurrentes de
> productos distintos pisando el mismo puntero— **no es un bug**: es la semántica
> pretendida de `LineaProduccionEstado` (puntero mutable con PK `lineaProductivaId`,
> evento íntegro en el log append-only), y el cooldown de 30 s por (línea, usuario)
> de `linea-producto-activo.service.ts:29-63` cierra la ventana. Lo único defendible
> ahí sería un guard `WHERE activadoEn < :ahora` para que un request reordenado no
> retroceda el puntero — Baja, ver B7.

---

**A4 — Transacción de batch sin `timeout`, sobre un pool de una sola conexión**
`src/db/calidad.repository.ts:477` + `src/lib/prisma.ts:17-22`.

Ningún `$transaction` del proyecto pasa `{ timeout, maxWait }`: rige el default de
Prisma (5 s / 2 s). El batch admite hasta 500 registros
(`registro.service.ts:123`) = **1000 `create` + N `$queryRaw` de secuencia**, en una
transacción interactiva. El adapter usa `max: 1`, así que esa transacción monopoliza
la única conexión de la instancia: cualquier otra query del mismo proceso espera
hasta `connectionTimeoutMillis: 10_000` y falla. (El `Promise.all(ops)` de `:541` no
paraleliza nada real — con una sola conexión Prisma los serializa igual.)

**Escenario de falla:** fin de turno, un operario guarda 24 muestras de Defectos de
Conformado (288 filas) mientras otro carga pallets desde otra tablet en la misma
instancia. El primero pasa de 5 s → `P2028 Transaction already closed` → el service
lo mapea a `ERROR_INTERNO` → el route lo devuelve como **400** (ver M1) → el
operario ve "Error interno al guardar los registros" y sus 24 muestras se perdieron.

Nota: `siguienteValorSecuencia` toma un row lock por `(linea, fecha, puntoControl)`
que se mantiene hasta el commit, así que dos batches del mismo punto de control se
serializan por completo — lo que suma tiempo dentro de la ventana de 5 s.

*Parche:* el fix principal es **`createMany`**, no el timeout — pasa de ~576
round-trips a 2, y es viable porque los `id` ya se generan en cliente (`:508`):
```ts
const registros: Prisma.RegistroCalidadCreateManyInput[] = [];
const auditorias: Prisma.AuditoriaRegistroCreateManyInput[] = [];
// ...llenar ambos arrays en el loop existente...
await tx.registroCalidad.createMany({ data: registros });
await tx.auditoriaRegistro.createMany({ data: auditorias });
```
con `{ timeout: 30_000, maxWait: 5_000 }` — `maxWait` **menor** que
`connectionTimeoutMillis: 10_000`, si no la carrera la gana el pool de `pg` y el
mensaje de error es el equivocado. Bajar el techo de 500 no arregla nada por sí
solo: el caso que rompe son 288 filas, que siguen entrando.

---

### MEDIA

**M1 — Sin mapeo `code → status` en los dos endpoints de registros**
`calidad/registros/route.ts:36` y `calidad/registros/batch/route.ts:39`:
`result.code === "CONFLICTO_CORRELATIVO" ? 409 : 400`. Todo lo demás sale **400**,
incluidos `PUNTO_CONTROL_NO_ENCONTRADO` (debería 404), `LOTE_NO_ENCONTRADO` (404),
`PUNTO_CONTROL_INACTIVO` (409) y `ERROR_INTERNO` (**500**). Verificado: un `loteId`
inexistente en el batch produce `P2003` → `ERROR_INTERNO` → 400. Un monitoreo por
status code no vería nunca los 5xx reales de este módulo.
*Parche:* un solo `STATUS_POR_CODE` compartido, reemplazando las tres copias
(`maestro-http.ts:9`, `lotes/route.ts:18`, `producto-activo/route.ts:21`). Tiene que
ser la **unión completa**: el mapa de `maestro-http.ts` no contiene ninguno de los
códigos de registros, así que copiarlo tal cual no arregla nada.

**M2 — Cuatro handlers `GET` sin `try/catch`, tres de ellos sobre parámetros que no se validan como UUID**
`calidad/lineas/route.ts:17`, `calidad/puntos-control/route.ts:24`,
`calidad/registros/route.ts:80-82`, `producto-activo/route.ts:63`.
`puntos-control` solo verifica que `lineaId` exista (`:20-22`), no que sea UUID;
`producto-activo` no lo valida en absoluto; el tramo `getRegistrosByLinea` tampoco
(su hermano con `puntoControlId` sí tiene `try/catch`, `:65-77`). `lineas` no recibe
parámetros: ahí solo falta el `try/catch`.
Verificado en sonda: las tres queries lanzan **`P2007` `invalid input syntax for
type uuid`**. El cliente recibe un cuerpo que no es JSON donde espera JSON, y
`res.json()` en el front rompe con un `SyntaxError` que `CalidadModuloView.tsx:105-150`
no distingue de un fallo de red. (Se descartó la hipótesis de fuga de stack trace al
cliente: en route handlers del App Router la excepción se loguea en el servidor y el
cliente recibe un 500 de texto plano.)
*Parche:* un helper `parseUuid()` compartido + `try/catch` en los cuatro,
**distinguiendo el tipo de error** para no contradecir M1: `P1001/P1002/P2024` → 503
`DB_NO_DISPONIBLE`; el resto → 500 `ERROR_INTERNO`. El helper no va en
`maestro-http.ts` (es plomería del maestro, con gate de rol admin): corresponde un
módulo propio, p. ej. `src/lib/http/params.ts`.

**M3 — El batch no verifica `loteId` / `lineaProductivaId` antes de escribir**
`registro.service.ts:112-210`. El camino individual sí lo hace (`:79-85`, con
`LOTE_NO_ENCONTRADO` / `LINEA_NO_ENCONTRADA`); el batch va directo a la transacción y
deja que la FK falle: `P2003` → `ERROR_INTERNO` → 400 "Error interno al guardar los
registros", indistinguible de un bug del servidor. La transacción revierte, así que
no hay corrupción — es un problema de contrato y de UX, y como el batch es el camino
de 10 de los 12 formularios, es el mensaje que vería el operario.
*Parche:* validar los `loteId`/`lineaProductivaId` únicos del batch con un `findMany`
antes de abrir la transacción, con los mismos códigos que el individual.

**M4 — `validateAgainstSchema` sin `try/catch` y recompilando por request**
`src/lib/validate-jsonb.ts:28`. Verificado: ante un `schema_json` malformado,
`ajv.compile()` lanza (`schema is invalid: data/properties/a/type must be equal to
one of the allowed values…`) y sube sin tipar hasta el route. Además, Ajv cachea por
**identidad del objeto** y Postgres entrega un objeto nuevo por request: no solo
recompila siempre, sino que **el caché interno crece sin techo** — fuga de memoria en
un proceso long-lived.
*Parche:* envolver en `try/catch` y cachear con clave versionada — cachear por
`puntoControlId` a secas haría que editar un `schema_json` no tome efecto hasta
reiniciar el proceso:
```ts
const cache = new Map<string, ValidateFunction>();
export function validateAgainstSchema(data: unknown, schema: unknown, cacheKey?: string): ValidationResult {
  let validate = cacheKey ? cache.get(cacheKey) : undefined;
  if (!validate) {
    try { validate = ajv.compile(schema as object); }
    catch (e) {
      console.error("[validate-jsonb] schema_json inválido:", e);
      return { valid: false, errors: ["El esquema del punto de control es inválido — avisá a sistemas"] };
    }
    if (cacheKey) cache.set(cacheKey, validate);
  }
  // ...
}
```
con `cacheKey = ${pc.id}:${pc.updatedAt.getTime()}` desde el caller.

**M5 — `npm run lint` no está configurado y nunca corrió**
`package.json:11` (`"lint": "next lint"`). Ejecutado en esta auditoría, abre el
asistente interactivo *"How would you like to configure ESLint?"*: no hay
`.eslintrc*` ni `eslint.config.*`, pese a tener `eslint@9` y `eslint-config-next@16`
instalados. En CI o en un hook, el comando cuelga o falla. El estándar global exige
"correr lint y typecheck antes de considerar terminado" y **la mitad de ese gate no
existe**. Reglas que habrían marcado hallazgos de este informe
(`no-floating-promises`, `@typescript-eslint/no-explicit-any` sobre los `as any` de
`calidad.repository.ts:449,523`) nunca se evaluaron. `typecheck` sí pasa limpio y
`npm run test` pasa 110 tests en 15 archivos.
*Parche:* `eslint.config.mjs` con el flat config de Next + TypeScript
(`projectService`) y `no-floating-promises` como error; validar con
`npx eslint . --max-warnings=0` antes de tocar `package.json`.

**M6 — El append-only HACCP es una convención del código, no una restricción del motor**
Evidencia directa en la base: `secuencias_diarias` tiene dos filas con
`ultimo_valor = 1` y **0 registros reales asociados**. Como el
`ON CONFLICT DO UPDATE` de la secuencia corre dentro de la misma transacción que el
`INSERT`, un rollback lo revertiría — la única explicación es un **`DELETE` manual
post-commit sobre `registros_calidad`**. Y no queda rastro de eso en ningún lado: no
hay `REVOKE DELETE` para el rol de la aplicación, ni trigger, ni auditoría a nivel
Postgres. `PROGRESO` ya lo anota como pendiente #5 ("evaluar M1 antes de Arcor");
esta auditoría confirma que el escenario no es hipotético.
*Parche:* `REVOKE UPDATE, DELETE ON registros_calidad, auditoria_registros,
auditoria_maestro, linea_activacion_log FROM <rol_app>` (el soft delete necesita
`UPDATE` sobre `registros_calidad`: acotarlo por columna o vía función `SECURITY
DEFINER`), y una migración con trigger `BEFORE DELETE ... RAISE EXCEPTION`.
Corresponde a `arquitecto-industrial` — es un cambio de contrato con el motor.

**M7 — La máquina de estados de `Lote` no existe**
`calidad.repository.ts:400-416`. `registrarCambioEstadoLote` escribe **solo** la fila
de `LoteEstadoLog` y nunca hace `lote.update({ estado })`; además no tiene
call-sites. Confirmado: `lote_estado_log` tiene 0 filas y todo lote queda en
`en_produccion` (`schema.prisma:244`) para siempre. Un lote no se puede aprobar,
rechazar ni poner en cuarentena — justo lo que un sistema de calidad necesita hacer
con un lote fuera de especificación. El riesgo de código concreto es la función
muerta que *aparenta* cambiar el estado y no lo hace.
*Parche:* fuera del alcance de un fix. Es regla de negocio: `scm-alimentos` primero,
después `arquitecto-industrial`.

**M8 — Doble semántica de "día": el `pallet_numero` se reinicia a medianoche en pleno turno noche**
- Lote: `fechaProduccion = jornadaProductiva()` — corte 6 am (`linea-producto-activo.service.ts:137`).
- Registro: `fecha` la manda el cliente con `hoyPlanta()` (los 8 formularios), y el
  GET default también (`registros/route.ts:61`).
- Secuencia: llaveada por `(linea, fecha, puntoControl)` (`calidad.repository.ts:145-151`).
- Índice de defensa: `(linea_productiva_id, fecha, data->>'pallet_numero')`
  (`prisma/migrations/20260720174244_secuencias_diarias_correlativos/migration.sql:19-23`).

La divergencia es deliberada y está documentada
(`src/lib/calidad/fecha-planta.ts:22-28`: "no confundir ni unificar ambos
conceptos"), pero tiene una consecuencia que el comentario no contempla: con turno
noche 22:00-06:00, a las 00:00 la `fecha` cambia, **la secuencia arranca de nuevo en
1** y el índice único no lo detecta porque la fecha difiere. Resultado: dentro del
mismo lote y la misma jornada quedan dos pallets físicos rotulados "1". Ante un
recall eso es un dato de trazabilidad falso — precisamente lo que el comentario de
esa migración dice querer evitar. Efecto secundario: la lista "registros del día" se
vacía a medianoche en plena jornada.
*Parche:* no se resuelve en la capa técnica. `scm-alimentos` primero (el rotulado de
pallet es regla de negocio), después `arquitecto-industrial`.

**M9 — La baja de una Marca o Familia no llega a producción: el flag `activa` es decorativo**
`actualizarMarca` / `actualizarFamilia` (`maestro.repository.ts:69-111`) aceptan
`activa: false`, pero `getProductosActivos` (`calidad.repository.ts:44-50`) filtra
**solo** `producto.activo`, y `activarProductoLineaService` (`:102-130`) verifica
`producto.activo` sin mirar marca ni familia. Se da de baja una marca en el maestro
y sus productos se siguen ofreciendo en el selector y se siguen activando en línea,
generando lotes nuevos.
*Parche:*
```ts
// calidad.repository.ts:45
where: { activo: true, marca: { activa: true }, familia: { activa: true } },
```
más un check con código propio (`MARCA_INACTIVA` / `FAMILIA_INACTIVA` → 409) en la
activación.

**M10 — Cambiar la familia de un producto huérfana sus especificaciones en silencio**
`actualizarProductoService` (`maestro.service.ts:214-245`) permite mover un producto
de familia sin tocar sus `EspecificacionProducto`, que están atadas a
`(producto, puntoControl, parametro)`. Como los puntos de control se asocian por
familia (`PuntoControlFamilia`), después del cambio `getEspecificacionesCaptura`
(`maestro.repository.ts:207-226`) puede devolver vacío para el punto de control
nuevo, o conservar specs de un punto que ya no aplica. **El formulario deja de
comparar contra especificación y no avisa nada** — pérdida silenciosa de control de
calidad, no de datos.
*Parche:* bloquear el cambio de familia si hay specs vigentes, o cerrarlas con
`cerrarEspecificacion` (ya escrita, `:318-342`) en la misma transacción y con su fila
de auditoría.

---

### BAJA

**B1 — `getTurnoByHora` traga cualquier excepción y persiste el registro sin turno**
`calidad.repository.ts:332-340`. Un blip de conexión al resolver el turno guarda el
registro con `turnoId: null`. **No es pérdida de trazabilidad**: la `hora` sí queda
persistida y el turno es 100 % derivable a posteriori con la misma tabla `turnos`.
Es un backfill pendiente, no un dato perdido. Y propagar la excepción sería peor:
tiraría abajo el guardado de 288 filas ya validadas por un blip de red. *Parche:*
dejar el comportamiento y agregar un script de backfill sobre las filas con
`turnoId: null`.

**B2 — Hueco de numeración en `secuencias_diarias`**
Consecuencia visible de M6: el próximo pallet de Producción Diaria de 2026-07-24 se
numeraría **2**, no 1. Un pallet #2 sin #1 es rastreable y explicable; lo grave es la
causa (M6), no el hueco. *Parche:* `scripts/verificar-secuencias.ts` que compare
`ultimo_valor` contra `max(nro_muestra)` real por `(linea, fecha, tipo)` y reporte
desfasajes.

**B3 — `numeroLote` determinístico con solo 3 reintentos**
`calidad.repository.ts:184-216`. El escenario "dos altas del mismo producto/línea en
el mismo minuto" **no puede ocurrir**: `activarProductoLinea` hace find-or-create
sobre `@@unique([productoId, lineaProductivaId, fechaProduccion])` (`:259-287`) y la
segunda activación reutiliza el lote sin llegar a `crearLote`; y el alta manual
(`lote.service.ts:46`) va sin `lineaCodigo` → `generarNumeroLoteGenerico`, con
granularidad de **segundo** (`:69-79`). Agotar los 3 intentos exige 4 lotes distintos
con misma línea, fecha, vida útil y minuto. Lo único real: el agotamiento cae en
`ERROR_INTERNO` genérico (`lote.service.ts:48-51`). *Parche:* código propio
`LOTE_NUMERO_AGOTADO` con mensaje accionable.

**B4 — Violación de capas en dos handlers de lectura**
`calidad/puntos-control/route.ts:7,24-28` importa `prisma` y consulta directo desde
el route; `calidad/lineas/route.ts:19-30` hace el mapeo DTO inline; los `GET` de
`producto-activo` (`:63`) y `registros` (`:66,80`) van al repository salteando el
service. Es la única desviación estructural del proyecto y concentra exactamente los
cuatro handlers de M2 — no es coincidencia: el código que no pasó por una capa
tampoco heredó su manejo de errores. *Parche:* va junto con M2.

**B5 — Rate limiting de login en memoria del proceso**
`src/lib/auth/rate-limit-login.ts`. El bloqueo de 5 intentos / 15 min vive en un Map
de módulo; el comentario del código asume una instancia única, pero `DATABASE_URL`
es Supabase cloud y el target de deploy es serverless multi-instancia, donde el
límite efectivo es *5 × número de lambdas*. La decisión de **no** bloquear por IP es
correcta y está bien justificada (spoofeable sin reverse proxy). Ante C1 esto es
irrelevante (no hay que adivinar nada), pero queda para después de la rotación.
*Parche:* mover el contador a Postgres (tabla `intentos_login` con TTL) o a un KV
externo, antes de exponer el login fuera de la red de planta.

**B6 — Fail-open de la validación de sesión ante error de DB**
`src/lib/auth/session-validation.ts:40-45`. Decisión documentada y defendible: un
blip de red no debe desloguear la planta entera, y sin DB no hay escrituras posibles
(las FK a `usuarios` protegen). Un usuario desactivado retiene sesión ≤1 min durante
un outage. No confundir con un fail-open de autorización: este es acotado y
consciente. Única observación: el `catch` no distingue "DB caída" de "query rota".

**B7 — El puntero de línea puede retroceder ante requests reordenados**
`calidad.repository.ts:291-299`. El `upsert` de `LineaProduccionEstado` no compara
`activadoEn`: dos POST casi simultáneos que lleguen fuera de orden dejan el puntero
en la activación más vieja. El log append-only conserva ambas, así que es
recuperable. *Parche:* guard `WHERE activadoEn < :activadoEn` en el update.

**B8 — El error de carga de "registros del día" no se muestra en tres formularios**
`TemperaturaForm.tsx:98`, `ProduccionDiariaForm.tsx:49` y
`TrazabilidadInsumosForm.tsx:39` desestructuran `useRegistrosDelDia` sin tomar
`error`, y `RegistrosDelDia.tsx:122` lo colapsa a `null` cuando llega por props
(`PesoMedicionesForm.tsx:668` sí lo muestra). **No genera 409**: tanto `nroMuestra`
como `pallet_numero` los reasigna el servidor de forma atómica
(`calidad.repository.ts:429,509` y `dataConCorrelativoSincronizado` `:422`), así que
lo que se guarda es correcto. Lo que está mal es **lo que el operario ve en pantalla**
frente a lo que queda en la base, sin aviso ni botón de reintento.

**B9 — `RegistroGenericoForm` usa un contrato distinto al resto**
`RegistroGenericoForm.tsx:92` decide el error con `if (json.error)` en vez de
`!res.ok`, y `:75` envía un `responsableId: "00000000-…"` que el servidor pisa
(`registros/route.ts:28`) — campo muerto que sugiere que el cliente elige el
responsable. Es, en cambio, el **único** formulario que muestra `details` al usuario;
el resto los descarta (`useBatchGuardar.ts:23`, `PesoMedicionesForm.tsx:325`,
`DefectosConformadoForm.tsx:401`), que es exactamente lo que hizo invisibles los tres
bugs de guardado del historial. Conviene invertirlo: su contrato al resto, y su
manejo de `details` al hook compartido.

**B10 — Higiene de efectos en el frontend**
`setTimeout` sin `clearTimeout` antes de `router.push` en seis formularios
(`useBatchGuardar.ts:28`, `AltaLoteForm.tsx:53`, `PesoMedicionesForm.tsx:327,940`,
`DefectosConformadoForm.tsx:406`, `RegistroGenericoForm.tsx:97`,
`EspecificacionesEditor.tsx:107`): ventanas de 1,5-2 s, `setState` sobre componente
desmontado si el usuario navega antes. Y `RegistrosDelDia.tsx:65-69` hace fetch sin
`AbortController` ni flag: al cambiar de punto de control gana la carga que resuelva
última, no la última pedida. Ruido, no pérdida de datos.

**B11 — `fecha` sintácticamente válida pero inexistente pasa la validación**
`registros/route.ts:62` valida `^\d{4}-\d{2}-\d{2}$` y `getRegistrosDelDia`
(`calidad.repository.ts:570`) hace `new Date(fecha)`. Verificado: `2026-02-31` pasa
el regex y devuelve 0 filas sin error (JS lo normaliza a marzo) — consulta silenciosa
sobre otra fecha.

**B12 — Sin clave de idempotencia en ningún POST de registros**
Un reintento de la tablet con red intermitente duplica registros: el `nroMuestra` lo
reasigna el servidor en cada request, así que el segundo POST idéntico produce un
pallet perfectamente legal a los ojos de `registro_unico`. Hoy la única defensa es el
flag `enviando` en memoria del cliente. Es contrato de API y `CLAUDE.md` marca
SAP/OT como integración futura: **escalar a `arquitecto-industrial`**.

**B13 — Índices no evaluados para crecimiento**
`getRegistrosByLinea` (`:582-594`) ordena por `(fecha desc, hora desc)` con índice
`(lineaProductivaId, fecha)`: el `hora` se ordena en memoria. Irrelevante con
`take: 50`; anotar para cuando `registros_calidad` crezca.

**B14 — N+1 menores**
`registro.service.ts:187-189` (una query de `turnos` por hora única del batch; el
comentario `:180-184` explica por qué es secuencial, pero podría ser una sola lectura
de la tabla) y `maestro.service.ts:184-196,226-236` (hasta 4 round-trips antes de la
transacción, que a su vez re-lee el producto). También
`scripts/import-maestro-productos.ts:211-212` (`findUnique` + `upsert` por fila del
Excel, solo para distinguir creado de actualizado).

---

## 6. Falsos positivos verificados y descartados

Se dejan documentados para que no vuelvan a levantarse en la próxima auditoría.

| Hipótesis | Verificación | Resultado |
|---|---|---|
| El batch nunca commiteó: `datosDespues: data as object` lleva `Date` a un campo `Json` y Prisma lo rechazaría | se replicó el shape exacto de `calidad.repository.ts:506-539` en una transacción con `throw` forzado | **Falso.** Ambos `create` pasan; el `Date` se serializa a `"2026-07-14T00:00:00.000Z"`. Conteos idénticos antes y después |
| El correlativo derivado de un GET fallido genera `CONFLICTO_CORRELATIVO` | `siguienteValorSecuencia` (`:140-157`) reasigna `nroMuestra` y `dataConCorrelativoSincronizado` (`:422`) reasigna `pallet_numero` | **Falso.** El valor del cliente es solo clave de agrupación intra-batch. Queda B8, que es un problema de display |
| Los 4 GET sin try/catch filtran stack trace al cliente | comportamiento de route handlers del App Router | **Falso.** La excepción se loguea en servidor; el cliente recibe 500 de texto plano. El problema real es el cuerpo no-JSON (M2) |
| Dos activaciones concurrentes de productos distintos corrompen el puntero de línea | semántica de `LineaProduccionEstado` + cooldown de `linea-producto-activo.service.ts:29-63` | **Falso.** Es la semántica pretendida. Queda B7 (reordenamiento), que es otra cosa |
| `numeroLote` colisiona en operación normal | find-or-create de `activarProductoLinea` + granularidad de segundo del generador legacy | **Falso** en el escenario descrito → reclasificado a B3 |
| 12 de 15 lotes están huérfanos por el bug transaccional de A3 | consulta de `estadoDeLinea is null` | **Falso.** Solo la última activación por línea retiene el puntero; los 12 restantes son históricos normales |
| El advisory de `@auth/core` es un fail-open de autorización existence-based | salida real de `npm audit` | **Impreciso.** Los advisories reales son homóglifo de `@`, excepción no capturada en `getToken()` y cookies OAuth no ligadas al provider (ver C3) |

---

## 7. Lo que está bien (para no romperlo)

- **Auth en los 14 endpoints, verificada una por una sin sesión:** las 14 devuelven
  `401 {"error":"No autorizado","code":"NO_AUTORIZADO"}`. El middleware excluye
  `api/` a propósito (`src/middleware.ts:9`) y cada handler la chequea por su cuenta.
- **Autorización sin escalada de privilegios:** los seis endpoints sin chequeo de rol
  son los correctos (captura de calidad = tarea de operario; lectura de config), y
  los dos que lo necesitan lo tienen (`lotes` POST → `ROLES_SUPERVISION_CALIDAD`;
  todo el maestro → `ROLES_ADMIN_MAESTRO` vía `gateAdminMaestro`). No hay IDOR/BOLA:
  el modelo no tiene "datos de otro usuario".
- **`responsableId` inyectado desde la sesión** en single (`registros/route.ts:28`) y
  batch (`batch/route.ts:34`); verificado que un valor suplantado se descarta.
- **Ningún endpoint filtra `err.message` ni stack** — los errores internos van a
  `console.error` y el cliente recibe texto genérico.
- **Escrituras del maestro:** todas en `$transaction` con fila de `AuditoriaMaestro`
  en la misma tx (`maestro.repository.ts:38,62-169,266-314`).
- **`siguienteValorSecuencia`** (`calidad.repository.ts:140-157`): `INSERT … ON
  CONFLICT DO UPDATE … RETURNING` dentro de la tx. Correlativo atómico de verdad.
- **Índices únicos parciales en SQL crudo** para lo que el DSL de Prisma no expresa:
  `especificaciones_producto_vigente_unica` y `registros_calidad_pallet_unico`.
- **Grafo de FKs mayormente en `RESTRICT`**: borrar un padre falla en vez de
  cascadear. `Cascade` solo en tablas puente y de auth.
- **Login endurecido:** hash dummy para igualar timing (`auth.ts:29`), normalización
  única del email, guard de boot contra `DEMO_MODE` en producción (`auth.ts:17-21`),
  validación de UUID antes del lookup de sesión (`session-validation.ts:25`).
- **Cobertura de tests:** 110 tests en 15 archivos, `typecheck` limpio. Concentrada
  en `lib/` y `services/`; no hay tests de `route.ts` ni de la capa `db/` sin mock.

---

## 8. Lotes de trabajo propuestos

Cada lote sigue el protocolo de `CLAUDE.md`. **El Lote 0 bloquea todo lo demás**:
hay veto activo de `seguridad-analista`.

| Lote | Hallazgos | Cadena de agentes |
|---|---|---|
| **0 — Autenticación (VETO)** | C1, C2, C3 | acción manual del usuario (rotar credenciales y secreto, `npm audit fix`) → `seguridad-analista` re-valida antes de cerrar |
| **1 — Segregación de entornos** | A1 | `arquitecto-industrial` → `seguridad-analista` |
| **2 — Trazabilidad HACCP** | A2, M6 | `arquitecto-industrial` (M6 cambia el contrato con el motor) → `backend-senior` → `seguridad-analista` → `documentador` |
| **3 — Transaccionalidad** | A3, A4 | `arquitecto-industrial` → `backend-senior` → `seguridad-analista` |
| **4 — Contrato HTTP y capas** | M1, M2, M3, M4, B4 | `backend-senior` → `seguridad-analista` |
| **5 — Tooling** | M5 | `backend-senior` |
| **6 — Maestro** | M9, M10 | `scm-alimentos` (¿qué debe pasar con las specs al cambiar de familia?) → `backend-senior` |
| **7 — Frontend** | B8, B9, B10 | `frontend-ux` → `backend-senior` (solo por el contrato de `details`) |
| **8 — Robustez de datos** | B1, B2, B3, B11, B13, B14 | `backend-senior` |
| **9 — Reglas de negocio abiertas** | M7, M8, B12 | `scm-alimentos` **primero** → `arquitecto-industrial` |
| **10 — Login distribuido** | B5, B6, B7 | `seguridad-analista` → `arquitecto-industrial` |

---

## 9. Fuera de alcance

- **Escritura real de registros.** Por decisión explícita del usuario esta auditoría
  no persistió ni una fila: no hay endpoint `DELETE` y los registros de calidad son
  append-only, así que un registro de prueba quedaría para siempre en la base. Los
  payloads de los 12 puntos de control se validaron end-to-end (Zod + AJV contra el
  `schema_json` vivo) cortando en la verificación de FK, y el camino de escritura del
  batch se verificó con rollback forzado. **Queda sin verificar únicamente el
  commit**: que la fila persista y sea legible después. El pendiente #4 de `PROGRESO`
  sigue abierto en ese sentido acotado.
- **Concurrencia real.** Las carreras de A3 y A4 se identificaron por lectura de
  código; reproducirlas requiere carga simultánea contra la DB, que implica escribir.
- **Comportamiento en Vercel.** `src/lib/prisma.ts:31` solo cachea el cliente en
  `globalThis` fuera de producción; el efecto de `max: 1` con múltiples instancias
  serverless no se midió. Nota relacionada: `DATABASE_URL` usa el puerto **5432**
  (conexión directa), mientras el ADR-014 en `src/lib/prisma.ts:11-16` justifica la
  configuración del adapter para el pooler de transacciones de Supabase (**6543**).
  Confirmar cuál se usa en el entorno desplegado.
- **Transporte y cifrado en reposo.** Los da Supabase y el hosting, no el código.
  Verificación de infraestructura pendiente, no auditable desde el repo.
- **`scripts/import-maestro-productos.ts`.** Relevado (ver B14), no auditado en
  profundidad — es una herramienta de carga puntual, no un flujo de runtime. Nota
  aparte: `xlsx@0.18.5`, que usa, tiene prototype pollution y ReDoS **sin fix
  disponible**; corresponde migrar a otra librería o aislar el script.
- **Módulos `OrdenProduccion` y `Ubicacion`.** Modelos definidos, 0 filas, ningún
  flujo que los use. No hay nada que auditar todavía.
