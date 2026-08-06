# ADR-017: Puntos de control de la estación de encajado/envasado (Línea 3) — rotura y peso con OPP

> **Ubicación de este documento.** ADR-017 vive en un archivo aparte porque `docs/architecture.md`
> ya pasó los 760 renglones y el documentador no tiene capacidad de edición in-place sobre un
> archivo de ese tamaño sin riesgo de truncarlo. **Este archivo es parte de la serie de ADRs de
> `docs/architecture.md`** y hay que leerlo como si fuera la sección siguiente a ADR-016. La
> sección final ("Parches pendientes a `docs/architecture.md`") lista, textual, los agregados que
> todavía faltan aplicar dentro de `architecture.md` — están pendientes, no hechos.

**Fecha:** 2026-08-06. **Estado:** implementado y aprobado por la cadena completa de agentes
(`scm-alimentos` → `arquitecto-industrial` → `backend-senior` → `frontend-ux` →
`seguridad-analista`, sin veto). 179 tests verdes, typecheck limpio.

**Ver también:** `docs/modulo-calidad.md`, sección "Estación de encajado / envasado (Línea 3)" —
las reglas de negocio en lenguaje de planta. Acá está el **cómo** técnico.

---

## Contexto

Se digitalizaron dos planillas de papel de la estación de encajado/envasado de Línea 3 —
el punto donde el alfajor pasa a producto terminado:

1. **Control de Rotura en Encajado** — cuánta unidad sale rota/golpeada, por máquina encajadora y hora.
2. **Control Peso Alfajor + OPP** — peso del alfajor ya envuelto en film OPP, más verificación de fechado.

**Decisión:** patrón ADR-001 puro. Cada control es **una fila en `puntos_control`** con su
`schema_json`. **Cero tablas nuevas**, `registros_calidad` sin tocar. La única migración es
aditiva sobre un enum (ver abajo).

## Modelo de datos

### Migración

`prisma/migrations/20260805120000_add_tipos_formulario_rotura_opp/migration.sql` — dos
`ALTER TYPE "TipoFormulario" ADD VALUE IF NOT EXISTS` (`rotura_encajado`, `peso_paquete_opp`).
Sin `INSERT`/`UPDATE`: desde PG 12 el `ADD VALUE` puede correr dentro de la transacción que
Prisma abre por migración, pero el valor **no se puede usar en esa misma transacción** — las
filas de `puntos_control` las siembra el seed, en otra conexión.

> **PENDIENTE — la migración todavía NO se aplicó** (falta `DIRECT_URL` en `.env.local`, ver
> ADR-014). **Orden obligatorio, no recomendado:**
> `prisma migrate deploy` → `prisma generate` → `npm run db:seed` → `npm run db:views`.
> El seed referencia `TipoFormulario.rotura_encajado`, así que falla si la migración no corrió.

### Los `schema_json` viven en `src/lib/`, no como const local del seed

`src/lib/calidad/schemas/rotura-encajado.schema.ts` y `src/lib/calidad/schemas/peso-opp.schema.ts`.
`prisma/seed.ts` los importa. **Razón:** así el test
(`src/lib/calidad/schemas/schemas.test.ts`) corre el **mismo** objeto que se siembra contra el
payload literal que arma el formulario. Es la defensa directa contra la trampa histórica del repo
— un schema que no coincidía con el payload real produjo "0 registros guardados" dos veces
(ADR-016). Si un schema nuevo se declara como const local del seed, esa defensa desaparece.

### `data` de "Control de Rotura en Encajado" (`tipoFormulario: rotura_encajado`)

Un registro por **(máquina encajadora, hora)**.

| Clave de `data` | Tipo | Cotas | Notas |
|---|---|---|---|
| `maquina` | `integer` | 1–2 | Espeja `filaProd`. Se duplica en `data` para que la vista de Power BI sea legible sin joins. **Sin `enum` a propósito:** `generate-views.ts` devuelve `TEXT` para cualquier propiedad con `enum` antes de mirar el `type` — con enum la columna saldría `TEXT` en vez de `INTEGER`. |
| `unidades_muestreadas` | `integer` | 1–5000 | Denominador real de la muestra. Default = `unidadesPorCaja` del producto activo, **editable** (caja incompleta por fin de pallet/amasijo). **Se persiste SIEMPRE.** |
| `golpeado_rotura_menor` | `integer` | 0–5000 | Grupo 1. |
| `golpeado_rotura_mayor` | `integer` | 0–5000 | Grupo 2. |
| `aplastado_rotura_leve` | `integer` | 0–5000 | Grupo 2. |
| `aplastado_rotura_intermedia` | `integer` | 0–5000 | Grupo 2. |
| `aplastado_rotura_mayor` | `integer` | 0–5000 | Grupo 2. |

`required` = las 7 claves. `additionalProperties: false`.

- **Por qué el denominador se persiste siempre:** si mañana cambia `unidadesPorCaja` en el
  maestro, los porcentajes históricos siguen siendo recomputables y siguen dando el mismo número
  que el día de la medición. Mismo criterio de ventana temporal que ADR-015.
- **Por qué el techo es 5000 y no 1000:** `Producto.unidadesPorCaja` es `Decimal(8,2)` y hay
  formatos a granel con cientos de unidades por caja (TAPAS). Con el techo en 1000, el default
  derivado del maestro para esos SKU nacía **fuera de schema** y AJV rechazaba el batch entero con
  un error genérico — exactamente el modo de falla "0 registros guardados" de ADR-016. El
  formulario espeja el mismo techo (`MAX_UNIDADES`) para avisar antes de enviar.
- **Los 3 porcentajes NO se persisten** (ver siguiente sección). Mandarlos en `data` hace fallar la
  validación por `additionalProperties: false`.
- La relación cruzada "suma de defectos ≤ `unidades_muestreadas`" no se expresa de forma legible
  en JSON Schema: se valida en el formulario.
- **"No muestreada = no registro"** (regla de negocio, ver `modulo-calidad.md`): una máquina parada
  o en cambio de formato no genera fila. El motivo se concatena en `notas` del registro de esa hora
  (`RoturaEncajadoForm`, acotado por `MAX_NOTAS_REGISTRO`).
- No se registra pallet ni envasador (decisión explícita del usuario — ver riesgos aceptados).

### Porcentajes derivados — `src/lib/calidad/rotura-encajado.ts`

Módulo puro, sin dependencias de framework ni de Prisma. Expone:

- `totalesRotura(conteos)` — suma por grupo.
- `porcentajesRotura(conteos, unidadesMuestreadas)` — los 3 porcentajes de UNA muestra.
- `porcentajesRoturaAgregados(muestras[])` — el agregado **PONDERADO**: suma de no-OK sobre suma
  de unidades inspeccionadas. **Nunca el promedio de los porcentajes** — el denominador es variable,
  así que promediar porcentajes sesga el resultado (1/10 y 1/90 → 2% ponderado vs. 5,56%
  promediado; el segundo número no significa nada). Las muestras con denominador no usable se
  **excluyen**: no aportan ni al numerador ni al denominador.
- `conteosDesdeData(data)` — camino de lectura desde el `data` JSONB ya guardado.

Un denominador ausente o `<= 0` devuelve `null`, **nunca 0**: "no se puede calcular" y "no hubo
rotura" son cosas distintas, y un 0% le diría al operario que la muestra está conforme.

**En Power BI los 3 porcentajes se calculan en DAX** sobre las columnas de contadores y
`unidades_muestreadas` de la vista. Eso da el ponderado correcto gratis: cualquier `AVERAGE` sobre
una columna de porcentaje precalculado sería el promedio de porcentajes, que está mal.

### `data` de "Control Peso Alfajor + OPP" (`tipoFormulario: peso_paquete_opp`)

Un registro por hora.

| Clave de `data` | Tipo | Cotas | Notas |
|---|---|---|---|
| `mediciones` | `array` de `number` | exactamente 10 ítems; cada uno 10–500, `multipleOf: 0.1` | Pesos **BRUTOS** en gramos (alfajor + film OPP). |
| `fechado_no_conformes` | `integer` | 0–10 | Cuántos de los 10 paquetes tienen fechado no conforme. |
| `fechado_tipo_falla` | `string` | enum `ausente` \| `ilegible` \| `fecha_incorrecta` \| `lote_incorrecto` | Obligatorio **solo** si `fechado_no_conformes >= 1`, vía `if/then`. |
| `fechado_observacion` | `string` | `maxLength: 300` | Opcional. |

`required` = `["mediciones", "fechado_no_conformes"]`. `additionalProperties: false`.
El **promedio no se persiste**: se recalcula desde `mediciones`
(`src/lib/calidad/mediciones-stats.ts`). El producto sale del producto activo de la línea (ADR-012),
no se elige por fila — la planilla de papel tenía columna PRODUCTO, el sistema ya lo resuelve con
la activación.

**Detalles del condicional de fechado, que no son cosméticos:**

- El `required: ["fechado_no_conformes"]` **dentro del `if`** es imprescindible: sin él, un payload
  que no trae la clave hace que el `if` pase en vacío y el `then` se aplique de más.
- **A propósito NO hay un `else` que PROHÍBA `fechado_tipo_falla` cuando el contador es 0.** Un
  `else` prohibitivo convierte un valor residual del formulario en 0 registros guardados — el modo
  de falla que ya pasó dos veces. El formulario resetea el campo al bajar el contador a 0 (y solo
  incluye la clave si `nc > 0`); el schema no castiga si se le escapa uno.
- Cuando el contador es 0, la clave se **omite** del payload. **Nunca se manda `null`**: el `type`
  es `string` y AJV rechazaría `null`.

**Qué es y qué NO es** (ver `modulo-calidad.md` para la versión de negocio): control de **PROCESO**
(ajuste de envolvedora, deriva). **NO** es verificación de contenido neto legal — el peso incluye la
tara del film. Como evidencia ante INAL/metrología legal no alcanza: faltarían tara declarada, peso
nominal de rótulo, identificación y verificación de balanza, y el esquema de muestreo del régimen
legal (que no es "10 consecutivos por hora"). Si algún día hace falta, es un **punto de control
separado** y **su límite no lo define la planta**.

**No se solapa con "Control Peso Alfajor"** (12 mediciones, alfajor desnudo): parámetros distintos
sobre puntos de control distintos, que es exactamente lo que habilita ADR-015 regla 1. Nota
lateral: si ambos se toman en la misma hora, `peso_opp − peso_alfajor` estima la tara del film.

### `fechado_envase` — RETIRADO, no "inactivo"

El punto de control "Control Fechado de Envase" se siembra con `activo: false` y su relación
`PuntoControlLinea` se borra explícitamente en el seed. **Documentarlo como "inactivo" es
insuficiente: está RETIRADO y no debe reactivarse.**

Desde este cambio, la verificación de fechado se registra dentro de "Control Peso Alfajor + OPP".
Si alguien reactiva el punto de control viejo, el **mismo hecho de negocio** puede vivir en **dos
`schema_json` distintos** simultáneamente, y cualquier reporte de fechado sale **incompleto con
cada mitad internamente consistente** — no hay nada que avise que falta la otra mitad. Ese es el
modo de falla peor: silencioso y plausible.

El valor `fechado_envase` queda en el enum solo por compatibilidad con registros históricos.

---

## (a) Semántica de `filaProd` por punto de control

`registros_calidad.fila_prod` es una columna estructural genérica (parte del unique
`registro_unico`, ver ADR-006). **No tiene un significado único: lo define cada punto de control.**

| Punto de control | `filaProd` significa | Rango | Clave espejo en `data` |
|---|---|---|---|
| Defectos de Conformado | Pico dosificador de la máquina | 1–12 | — |
| Control de Rotura en Encajado | Máquina encajadora | 1–2 | `maquina` |

**Regla: todo punto de control nuevo que use `filaProd` DEBE agregar su fila a esta tabla.** Si no
está acá, el significado de esa columna para ese PC no existe en ninguna parte y el próximo que
escriba un reporte lo va a inventar.

**Advertencia para quien escriba consultas o medidas de Power BI:** cualquier consulta transversal
"agrupada por `filaProd`" que cruce puntos de control distintos devuelve un **promedio sin
sentido** — estaría promediando "pico dosificador 1" con "máquina encajadora 1". No son la misma
dimensión, solo comparten el nombre de la columna. Toda agregación por `filaProd` tiene que estar
filtrada a un único punto de control.

Las 2 máquinas de una misma hora **comparten `nroMuestra`** y se distinguen por `filaProd` —
mismo patrón que los 12 picos de Defectos de Conformado, y es lo que hace que el asignador atómico
de correlativos (ADR-006) les dé UN solo valor por grupo y queden apareadas.

## (b) Invariante de `campoData`: los dos sentidos que el modelo no distingue

`puntos_control_parametros.campo_data` (ADR-015) significa **dos cosas distintas según la fila**:

1. **Clave REAL** del `data` JSONB — ej. `mediciones`, `temp_ddl`, `filas[].peso_neto`.
2. **Identificador LÓGICO** de un valor que **no existe en `data`** y lo calcula un módulo de
   `lib/` — ej. `pct_rotura_grupo1`, `pct_rotura_grupo2`, `pct_rotura_total`, calculados en
   **`src/lib/calidad/rotura-encajado.ts`**.

**Nada en el modelo de datos distingue los dos sentidos.** No hay columna de tipo, no hay flag.

**Invariante que se sostiene:** si `campoData` **no** corresponde a una clave declarada en el
`schemaJson` del punto de control, entonces `agregacion` **tiene que ser `derivado`**.

**Riesgo concreto que esto protege** (no hipotético a futuro): el día que se escriba un evaluador
server-side de desvíos, va a leer `data[campoData]`. Un binding con `campoData` mal escrito y
agregación `escalar`/`array_cada` va a leer `undefined` y **saltear ese parámetro en silencio** —
incluidos los que tengan `esCritico: true`. Un evaluador HACCP con falsos negativos silenciosos es
peor que no tener evaluador.

**Protegido por `src/lib/calidad/schemas/bindings-coherencia.test.ts`** — test de coherencia sobre
schemas y bindings declarados, corre sin conexión a DB. El array `BINDINGS` de ese test replica a
mano los bindings del seed: **si el seed cambia, el test tiene que cambiar con él. Es intencional**
— ese es el punto donde se nota la desalineación. El test además espeja las cotas que
`PesoOppForm`/`RoturaEncajadoForm` duplican en constantes propias (`PESO_MIN`/`PESO_MAX`/
`PESO_DECIMALES`, `MAX_UNIDADES`): si el schema cambia y el formulario no, el operario vuelve a
recibir "1 registro(s) con datos inválidos" sin saber qué corregir.

> **Aclaración que corrige a ADR-015:** `agregacion: derivado` **NO** significa "se evalúa al
> cierre". ADR-015 (regla 6) lo dejó implícito porque el único caso era `peso_baño`, que sí se
> evalúa al cierre de jornada. Los `pct_rotura_*` son `derivado` **y se comparan en vivo** contra
> la spec mientras el operario carga. `derivado` significa únicamente: "el valor no es una clave de
> `data`; lo calcula código, no se persiste".

Cómo funciona en el formulario: `specDeCampo()` hace match de **string** contra el array de
especificaciones — no lee `data`. El formulario le pasa el porcentaje ya calculado por
`rotura-encajado.ts`.

---

## Especificaciones (ADR-015): 4 parámetros nuevos, cero specs sembradas

**Parámetros nuevos** (`prisma/seed.ts`, catálogo cerrado):

| `clave` | `unidad` | Binding | `campoData` | `agregacion` |
|---|---|---|---|---|
| `pct_rotura_grupo1` | `%` | Control de Rotura en Encajado | `pct_rotura_grupo1` | `derivado` |
| `pct_rotura_grupo2` | `%` | Control de Rotura en Encajado | `pct_rotura_grupo2` | `derivado` |
| `pct_rotura_total` | `%` | Control de Rotura en Encajado | `pct_rotura_total` | `derivado` |
| `peso_paquete_opp` | `g` | Control Peso Alfajor + OPP | `mediciones` | `array_cada` |

El catálogo pasa de **15 a 19 parámetros** y de **18 a 22 bindings** (línea de base en
ADR-015/ADR-016).

**No se sembró ninguna `EspecificacionProducto`.** Es deliberado: las tolerancias reales las carga
el usuario desde `/maestro` cuando consiga la **ET vigente** (y la de Arcor para los SKU copacker).
Los formularios funcionan en estado "sin spec" y muestran el rango en vivo cuando exista. Sembrar
una tolerancia inventada sería un dato de calidad falso circulando en trazabilidad de exportación
— mismo criterio que el `sku` nulo de ADR-010.

**Los 2 puntos de control quedan SIN asociar a familia, a propósito.** Las familias reales las crea
`scripts/import-maestro-productos.ts` desde el Excel; el seed solo garantiza `alfajor_negro` y
`tapas`. Bindearlos a `alfajor_negro` **esconde el control** para el resto de los alfajores,
incluido el SKU copacker de Arcor. Sin familia, el PC aplica a cualquier producto de la línea
(regla ya existente de la grilla: PCs sin familia siempre se muestran).

Relaciones `PuntoControlLinea` en Línea 3: `Control de Rotura en Encajado` orden 10,
`Control Peso Alfajor + OPP` orden 11 — después de Trazabilidad Insumos (9), reflejando el flujo
productivo hasta la estación de encajado.

---

## `scripts/generate-views.ts`: bugs previos que este cambio destapó y cerró

Complementa **ADR-002** (vistas SQL generadas programáticamente). Nada de esto es feature nueva:
son fallas que existían desde antes y se descubrieron al intentar exponer los 2 PCs nuevos a
Power BI.

### 1. Ninguna vista existía. Ninguna. Durante meses

Las vistas referenciaban `p.linea` y `p.tipo_cliente`, **columnas que nunca existieron en
`productos`** (los enums `LineaProducto`/`TipoCliente` se eliminaron en ADR-010, y en rigor la
línea de negocio nunca vivió en `productos`). Resultado: **el DDL de TODAS las vistas fallaba**, el
script logeaba el error, imprimía "generación completada" y **salía con código 0**. Nadie se
enteró: no había ninguna vista generada y **la línea de negocio nunca llegó a Power BI**.

**Fix:** las vistas hacen `JOIN familias f ON p.familia_id = f.id` y `JOIN marcas m ON p.marca_id
= m.id`, y exponen `f.nombre AS familia`, `m.nombre AS marca` y **`m.linea_negocio AS
linea_negocio`** — que es donde la línea de negocio vive de verdad (ADR-010: es atributo de la
marca, no del producto). Esto es lo que permite separar en Power BI marca propia / copacker Arcor /
fasón terceros.

Alcance real del fix (para no sobre-prometer): `linea_negocio` está en las vistas **anchas por
punto de control** y en **`vw_calidad_formato_largo`**. **`vw_calidad_ultima_muestra` NO joinea
`marcas` y NO expone `linea_negocio`** — ver "Huecos" al final.

### 2. Las fallas ahora hacen `throw`

Se cuentan (`fallas`) y al final se lanza un error. **Un conjunto parcial de vistas no es confiable
para reportar**: mejor romper ruidosamente que dejar a Power BI leyendo un subconjunto sin que
nadie lo sepa. Este era el habilitador del bug #1.

### 3. `DROP VIEW IF EXISTS` + `CREATE VIEW`, en vez de `CREATE OR REPLACE`

Postgres **no permite quitar ni reordenar columnas** con `REPLACE`: agregar una propiedad en el
medio de un `schema_json` fallaba con "cannot change name of view column" y **dejaba la vista vieja
en pie mientras Power BI la leía como si estuviera al día**.

**Sin `CASCADE`, a propósito.** `CASCADE` borraría en silencio cualquier vista o matview que
alguien haya montado encima. Que falle y se decida a mano.

### 4. Soft-delete HACCP: las 3 vistas filtran `rc.deleted_at IS NULL`

`registros_calidad` es soft-delete (nunca borrado físico). Sin el filtro, **una muestra anulada por
error de carga entra al reporte que se le muestra al cliente como si fuera un dato real**. Aplica a
las vistas anchas, a `vw_calidad_formato_largo` y a `vw_calidad_ultima_muestra` — en esta última es
doblemente importante, porque sin el filtro el `DISTINCT ON` puede elegir justo el registro anulado
como "última muestra" del lote.

### 5. Escapado del DDL y colisión de nombres de vista (seguridad)

El script usa `$executeRawUnsafe`, que además acepta múltiples sentencias. Se agregó:

- `sqlLiteral()` (duplica `'`), `sqlIdent()` (duplica `"`), `comentarioSeguro()` (un `\n` en un
  nombre saca el resto de la línea del comentario `--` y lo vuelve SQL ejecutable).
- Validación `IDENT_OK = /^[a-z][a-z0-9_]{0,62}$/` sobre el **nombre crudo** de cada propiedad,
  **antes** de interpolarlo: `toColumnName` sanea el alias, pero el literal del `data ->>` lleva el
  nombre tal cual — una propiedad como `x')::text AS a, (SELECT ...) AS b, (rc.data->>'y` cerraba
  el literal y agregaba SQL arbitrario. Fuera de ese patrón no hay caso de negocio válido: se corta
  ruidosamente con `throw`.
- **Detección de colisión de nombre de vista.** `toViewName` no es inyectivo: "Control Peso Alfajor
  + OPP" y "Control Peso Alfajor OPP" colapsan al mismo nombre. Sin el chequeo, el segundo PC
  dropea y reemplaza la vista del primero **sin ningún error**, y Power BI sigue leyendo el mismo
  nombre mostrando los datos del PC equivocado.

**Contexto de seguridad y condición de veto de `seguridad-analista`:** el script corre con
`DIRECT_URL`, o sea **el rol dueño del schema**. Una inyección por esta vía no sería "leer datos de
más", sería **DDL arbitrario con permisos de owner**. Hoy los `schema_json` y los nombres de punto
de control vienen **solo del seed**, así que no era explotable — pero:

> **Condición de veto (vigente, `seguridad-analista`):** si aparece **cualquier camino de escritura
> desde la app** hacia `puntos_control.nombre` o `puntos_control.schema_json` (por ejemplo una UI
> de `/maestro` que permita editar schemas, o un import de Excel que toque puntos de control), eso
> es **veto automático** salvo que el escapado ya esté en su lugar — que **ahora lo está**. No
> quitar `sqlLiteral`/`sqlIdent`/`comentarioSeguro`/`IDENT_OK` "porque hoy no hay input de
> usuario".

---

## Riesgos aceptados por el usuario

Se asientan acá a pedido de `arquitecto-industrial`, para que queden en un documento y no solo en
un hilo de conversación. **Son decisiones tomadas a conciencia, no bugs.**

### (i) No se registra pallet

`data` no tiene `pallet_referencia`. Consecuencia concreta: **si en una hora se cierran 2 pallets,
el operario no puede cargar ambas muestras** para esa hora/máquina, y ante un rechazo de Arcor el
cruce **muestra → pallet** es ambiguo (se puede acotar por hora y correlativo de pallet de
Producción Diaria, pero no atar la muestra al pallet).

**Recuperable después sin migración:** agregar `pallet_referencia` al `schema_json` del punto de
control (patrón ADR-001, cero DDL). Los registros viejos simplemente no tendrán la clave.

### (ii) No se registra el destino de la caja abierta ni de las unidades no conformes — PREGUNTA ABIERTA A PLANTA

Se abre ~1 caja por máquina por hora para inspeccionar: del orden de **~700 unidades/día abiertas**.
Hoy el sistema **no registra qué pasa con esa caja ni con las unidades no conformes**. Dos
consecuencias distintas:

1. **Merma no registrada.** El costo de la inspección no aparece en ningún lado.
2. **Posible punto de reintroducción de contaminación:** si la caja se **recierra después del
   detector de metales (PCC1)**, ese producto salió del circuito de control del PCC y volvió a
   entrar sin re-verificación.

**Esto es una pregunta abierta a planta, no una decisión cerrada.** Hay que averiguar qué se hace
hoy con la caja abierta antes de decidir si el sistema tiene que registrarlo, y si corresponde
tratarlo en el plan HACCP. No se modeló nada al respecto en este cambio.

### (iii) Las tolerancias no se siembran hasta tener la ET

Los 4 parámetros existen, los bindings existen, no hay ninguna `EspecificacionProducto`. Hasta que
el usuario cargue la ET vigente (y la de Arcor para los SKU copacker), los formularios funcionan en
estado "sin spec": registran igual, pero **no hay comparación medido-vs-estándar** y nada colorea
un valor fuera de rango.

---

## Deuda y pendientes

### De este cambio

- **Migración sin aplicar** — ver el bloque PENDIENTE arriba. Falta `DIRECT_URL` en `.env.local`.
- **Mapeo de `ProductoActivoLinea` duplicado** (deuda registrada por `arquitecto-industrial`): el
  aplanado del estado de Prisma al contrato existe dos veces — en
  `src/app/api/v1/lineas-productivas/[lineaId]/producto-activo/route.ts` y en
  `src/app/calidad/[lineaId]/[puntoControlId]/page.tsx`. Debería ser un único mapper. Se agravó con
  este cambio: `unidadesPorCaja` es el tercer campo que hay que agregar en dos lugares o el
  formulario pierde el default en silencio.
- **Duplicación consciente y acotada:** `src/lib/calidad/mediciones-stats.ts` replica `calcularStats`
  de `PesoMedicionesForm.tsx` (1190 líneas, con un submodo frágil) para no tocar ese archivo.
  Decisión explícita de alcance, no un descuido — el camino correcto a futuro es que
  `PesoMedicionesForm` consuma el módulo de `lib/`.
- `npm run lint` **está roto de antes** de este cambio: el script llama a `next lint` y el repo no
  tiene archivo de configuración de ESLint, así que abre el asistente interactivo y se cuelga. No
  se tocó (no es parte de este cambio), pero cualquiera que corra el checklist "lint + typecheck"
  se lo va a encontrar.

### Escalado a `arquitecto-industrial` — NO parte de este cambio

Levantado por `backend-senior` y `seguridad-analista`, fuera de alcance, pendiente de decisión:

- **(a) Idempotencia de la ingesta.** Un reintento de `POST` (timeout con el commit ya hecho, doble
  tap, dos pestañas abiertas) crea un **segundo juego de registros con correlativo nuevo**, y
  `registro_unico` no lo ve (el correlativo es distinto). En rotura eso **diluye una desviación real
  hacia "en spec"**: se duplican unidades inspeccionadas y defectos, pero si la duplicación es
  parcial el ponderado se corre. **Fix mínimo propuesto:** índice único parcial sobre
  `(punto_control_id, lote_id, fecha, hora, fila_prod) WHERE deleted_at IS NULL`.
- **(b) Qué es "el día"** cuando la línea cambia de producto a mitad de jornada. Hoy el agregado de
  rotura se filtra por **lote activo** (de ahí el título "Rotura del lote"), que evita mezclar
  productos, pero no resuelve el concepto general — que además convive con la jornada 6am-6am de
  alcance acotado (ADR-013).

### Pendientes de seguridad, por orden de prioridad

1. **Rol `powerbi_ro` de solo lectura sobre las `vw_*`, antes del primer refresh de Power BI.** Hoy
   el README documenta conectar con la credencial **dueña del schema** — con las vistas recién
   funcionando por primera vez, esto pasa de teórico a inminente.
2. **Vista de registros anulados**, para que HACCP vea las anulaciones **tachadas y no invisibles**.
   Contrapartida directa del filtro `deleted_at IS NULL` que se agregó a las 3 vistas: el reporte
   del cliente queda limpio, pero hoy no hay ninguna vista donde auditar lo anulado.
3. **Validación server-side de coherencia `puntoControl ↔ línea ↔ lote`** en el endpoint batch.
4. **Auditoría inalterable a nivel DB.** Hoy `AuditoriaRegistro`/`auditoria_maestro` son append-only
   **solo por convención de código** (deuda M1 de ADR-015): el rol de la app conserva
   `UPDATE`/`DELETE`.
5. **Límite de tamaño de body** en el endpoint batch.
6. **`next@14.2.35` tiene advisories High.** **No exponer la app fuera de la LAN de planta con esta
   versión.**

---

## Parches PENDIENTES a `docs/architecture.md` (no aplicados)

No se pudieron aplicar in-place. Son agregados chicos y puntuales; hasta que se apliquen,
`architecture.md` está **desactualizado** en estos puntos:

1. **Serie de ADRs:** agregar, después de ADR-016, un puntero:
   `## ADR-017: ... → ver docs/adr-017-encajado-envasado.md`.
2. **ADR-002 (vistas SQL):** agregar la nota de que las vistas **nunca se generaron** hasta
   2026-08-06 (referenciaban `p.linea`/`p.tipo_cliente`, columnas inexistentes; el script salía con
   código 0) y que ahora joinean `familias`/`marcas`, exponen `m.linea_negocio`, hacen `throw` ante
   fallas, usan `DROP`+`CREATE` sin `CASCADE`, filtran `deleted_at IS NULL` y escapan el DDL →
   detalle en ADR-017.
3. **Sección `enum TipoFormulario`:** agregar los **2 valores nuevos** `rotura_encajado` y
   `peso_paquete_opp` (migración `20260805120000_add_tipos_formulario_rotura_opp`, **sin aplicar
   todavía**), y reescribir el bullet de `fechado_envase` de "desactivado" a **"RETIRADO — no
   reactivar"** con el razonamiento de los dos schemas para el mismo hecho de negocio.
4. **Diccionario, `Producto.unidadesPorCaja`:** agregar "**Desde ADR-017 viaja en el contrato
   `ProductoActivoLinea`**" (es el default editable del denominador de rotura; `Decimal(8,2)`, se
   redondea a entero en el formulario).
5. **Sección "Contrato de datos — `ProductoActivoLinea`" (ADR-012):** el tipo ganó
   `unidadesPorCaja: number | null` (`src/types/calidad.ts`). Misma advertencia que ya tiene
   `vidaUtilMeses`/`nomenclaturaLote`: si alguien "limpia" el tipo, `RoturaEncajadoForm` pierde el
   default del denominador **en silencio**.
6. **`Parametro` / `PuntoControlParametro`:** actualizar los conteos de **15 → 19 parámetros** y
   **18 → 22 bindings**.
7. **Nueva subsección de diccionario** por cada PC nuevo (formato de las de "Trazabilidad Insumos" /
   "Control Peso Tapas"), con el `data` de cada uno → copiar de las tablas de este ADR.
8. **Sección "Deuda técnica y decisiones pendientes":** sumar migración sin aplicar, `npm run lint`
   roto, mapper duplicado de `ProductoActivoLinea`, idempotencia de la ingesta (escalada),
   `powerbi_ro`, vista de anulados, límite de body en el batch y el advisory de `next@14.2.35`.
9. **Corregir "los 8 formularios de calidad"** (aparece en ADR-012 y ADR-015): hoy Línea 3 tiene
   **12** puntos de control asociados.
