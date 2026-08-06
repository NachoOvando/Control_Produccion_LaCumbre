# Módulo Calidad — Reglas de negocio

Reglas aprobadas por scm-alimentos. Este documento describe **qué** registra cada formulario y por qué; el **cómo** técnico está en `architecture.md` (ADRs) y `api-reference.md`.

## Regla transversal

Todos los formularios muestran, arriba o junto a la carga, **los registros ya cargados en el día** para ese punto de control y esa línea (vía GET de registros del día — ver `api-reference.md`). El operador siempre ve qué se registró antes en su turno.

## Habilitación de puntos de control (gate de rollout, desde 2026-08-06)

La puesta en producción arranca con **8 de los 12** puntos de control asignados a Línea 3 habilitados. Los otros 4 se ven en la grilla **en gris, con badge "Próximamente" y sin poder abrirse** — no se ocultan: el operario tiene que ver que el control existe y todavía no está en uso, no que no existe.

**Habilitados hoy:** Peso Alfajor + OPP · Rotura en Encajado · Producción Diaria · Detector de Metales (PCC1) · Trazabilidad Insumos · Temperatura Condensación Túnel · Defectos de Conformado · Temperatura Tanques.

**Deshabilitados por el gate:** Control Peso Alfajor (el básico) · Peso Relleno · Peso Baño Alfajor · Peso Tapas.

> **Consecuencia operativa a tener presente:** con Peso Baño Alfajor y Peso Tapas apagados **no se está midiendo peso de cobertura de chocolate** (la resta apareada descrita en `architecture.md`), y con Peso Relleno apagado no hay control de dosificado de relleno. Ningún PCC se pierde: el único es el detector de metales, y está habilitado. Habilitar el resto es una decisión de plan de calidad, no técnica.

### Dos significados distintos de `activo`, no confundirlos

El flag `puntos_control.activo` se usa hoy para **dos cosas opuestas**, y el discriminador es si el punto de control conserva su fila en `puntos_control_lineas`:

| | `activo` | ¿fila en `puntos_control_lineas`? | Significado |
|---|---|---|---|
| **Retirado** (Fechado de Envase) | `false` | **no** (se borra en el seed) | Muerto. No se reactiva — ver la sección de fechado más abajo. |
| **Gate de rollout** (los 4 de peso) | `false` | **sí** | Temporal. Se va a habilitar; por eso se ve en gris en vez de desaparecer. |

### Cómo habilitar uno más

Un `UPDATE` sobre la DB, **sin redeploy** — nada en el código hardcodea la lista:

```sql
UPDATE puntos_control SET activo = true WHERE nombre = 'Control Peso Relleno';
```

Cuidado con el nombre: `Control Peso Alfajor` es **prefijo** de `Control Peso Alfajor + OPP`. Usar siempre igualdad exacta, nunca `LIKE 'Control Peso Alfajor%'`, o se toca el punto de control equivocado.

**El seed no interviene:** los 4 llevan `activo: false` solo en el bloque `create`, no en el `update`. Sobre una DB existente un re-seed no deshabilita ni rehabilita nada — el estado vigente es siempre el de la DB. La contracara es que un staging re-seedeado *encima de datos viejos* va a mostrar los 12 habilitados; en una DB nueva, en cambio, nacen deshabilitados.

### Qué pasa si alguien intenta cargar en uno deshabilitado

Está bloqueado en tres capas, porque el gate se mueve a mano y puede moverse con un operario a mitad de carga:

1. **Grilla** — la tarjeta no es un link (es un `<div>`, no un `<a>` con `cursor-not-allowed`: eso sería solo cosmético en una tablet).
2. **URL directa** — la página de captura redirige al listado antes de renderizar el formulario, así que una URL guardada no sirve.
3. **API** — el service rechaza con `PUNTO_CONTROL_INACTIVO`, tanto en el alta individual como en el batch, y en el batch **no se guarda ningún registro** del lote enviado.

## Producción Diaria

- **Pallet correlativo automático por día y por línea.** Hoy se calcula en el cliente a partir de los registros del día; el diseño objetivo lo asigna el servidor (ADR-006, pendiente).
- **Pallet incompleto:** se marca con un flag y se registra la cantidad de cajas.
- **Vencimiento:** derivado del producto (`vida_util_meses`): fecha de producción + meses, formato `MM/yyyy`. No lo tipea el operador.
- **Lote PT (actualizado 2026-07-21, ver ADR-011/ADR-016):** se **sugiere** automáticamente con el `Lote.numeroLote` del producto activo de la línea (mostrado en verde), pero el campo es **editable** — el operario puede declarar un lote distinto si hace falta, con un botón "Usar sugerido" para volver al valor por defecto. El override queda guardado en la sesión del navegador (no se pierde al recargar la pestaña) y se resetea solo si cambia el lote activo de la línea. (Entre el 20 y el 21 de julio de 2026 este campo fue de solo lectura, sin posibilidad de editarlo — el relevamiento de planillas físicas de TAPAS mostró que hacía falta poder declarar un lote distinto en casos puntuales, así que se volvió a habilitar la edición.)
- **Peso del alfajor:** solo se pide (y solo se guarda) cuando el producto activo de la línea es de la familia **Alfajor Negro**. Con otra familia activa (ej. TAPAS) el campo no aparece.
- **Tiempo de túnel:** se registra **una vez por turno**; hay que volver a registrarlo si cambia la velocidad de la línea.

## Trazabilidad Insumos (Línea 3)

- Un registro por **cambio de lote de insumo**, no por turno.
- **Insumos disponibles, filtrados según la familia del producto activo (desde 2026-07-21, ver ADR-016):**
  - Con **Alfajor Negro** activo: Tapas Bañadas, Bon o Bon, Dulce de Leche, Cobertura de Chocolate (renombrado desde "Baño Chocolate" para alinear con el lenguaje real de planta — mismo insumo).
  - Con **TAPAS** activo: Tapas Sin Bañar (la tapa cruda que entra al proceso de baño — distinta de "Tapas Bañadas", que es la salida de ese mismo proceso y no corresponde trazarla como insumo de TAPAS) y Cobertura de Chocolate.
- Campos: lote del insumo y observaciones opcionales.
- El filtro por familia es solo de interfaz (ayuda a no elegir un insumo que no corresponde); el servidor no lo fuerza — deuda conocida, documentada en `architecture.md` (ADR-016).
- Objetivo: ante un recall, cruzar el horario del cambio de lote con los correlativos de pallet del día para acotar la mercadería afectada.

## Temperatura de tanques

Cuatro campos: **DDL**, **Bon o Bon**, **Cobertura 1**, **Cobertura 2**.

## Peso de relleno

Opciones de relleno: **Dulce de Leche**, **Bonobon**, **DDL + BoB**, **Otros** (con aclaración obligatoria).

## Peso del baño (Alfajor Negro)

No se pesa el baño directo: se calcula como el **promedio de restas apareadas** `P_i con baño − P_i sin baño`, entre la última muestra sin baño y la última con baño de la jornada. El tipo de producto "solo baño" fue eliminado. Escurrimiento opcional (no se mide en cada muestra en la práctica de planta).

**Este es el punto de control "Control Peso Baño Alfajor" y es exclusivo de la familia Alfajor Negro** (ver más abajo, "Peso de Tapas" — desde el 2026-07-21 dejaron de ser el mismo formulario compartido).

## Peso de Tapas (nuevo, 2026-07-21 — ver ADR-016 en `architecture.md`)

Punto de control propio ("Control Peso Tapas"), exclusivo de la familia **TAPAS** — nunca se muestra junto con "Peso del Baño (Alfajor Negro)" en la grilla de un mismo producto activo.

- **12 observaciones (una por pico dosificador de la máquina).** Cada observación pesa **la misma tapa dos veces**: sin bañar y con baño. No hay una tercera pesada manual de "baño suelto".
- **La cobertura de chocolate se calcula sola**, en vivo, como la resta `peso con baño − peso sin bañar` de cada observación — el operario no la tipea. Se muestra fuera de especificación coloreada si corresponde, con un resumen de "N valores fuera de especificación" al completar la muestra.
- Temperatura ambiente y temperatura del baño: obligatorias. Escurrimiento: opcional.
- **Antes de esta fecha, este control (modo "Tapitas") vivía dentro del mismo formulario que "Peso del Baño" de Alfajor, con una fila manual de "baño suelto" que no correspondía al proceso real de planta.** Ese diseño compartido nunca guardó un registro válido: el payload no coincidía con el schema — **0 registros de TAPAS se guardaron jamás** hasta este fix. Ver ADR-016 en `architecture.md` para el detalle completo del bug y la corrección.

---

# Estación de encajado / envasado (Línea 3) — nuevo, 2026-08-06

Dos planillas de papel de la estación donde el alfajor pasa a producto terminado, digitalizadas como dos puntos de control nuevos. Ver **ADR-017** en `architecture.md` para el detalle técnico y los riesgos aceptados.

Los dos controles quedan **sin familia asignada a propósito**: aparecen para cualquier producto de la línea, incluido el SKU copacker de Arcor. Si se los bindeara a `alfajor_negro`, el control desaparecería para el resto de los alfajores (las familias reales las crea el import del maestro desde el Excel; el seed solo garantiza `alfajor_negro` y `tapas`).

## Control de Rotura en Encajado

Cuánta unidad sale rota o golpeada del encajado, por máquina encajadora y por hora.

**Qué se registra**

- **Un registro por (máquina encajadora, hora).** Las 2 máquinas de una misma hora quedan apareadas: comparten el número de muestra y se distinguen por la posición (máquina 1 o 2), igual que los 12 picos dosificadores de "Defectos de Conformado".
- **Unidades inspeccionadas** (el denominador). Se propone automáticamente con las unidades por caja del producto activo, pero es **editable**: la caja real a veces está incompleta (fin de pallet, fin de amasijo).
- **5 contadores de unidades no conformes**, en dos grupos que vienen de la Especificación Técnica:
  - Grupo 1: golpeado con rotura menor.
  - Grupo 2: golpeado con rotura mayor, aplastado con rotura leve, aplastado con rotura intermedia, aplastado con rotura mayor.
- No se registra pallet ni envasador (decisión explícita del usuario — ver riesgos aceptados en ADR-017).

**Por qué las 5 categorías no se colapsan en una sola:** no es granularidad decorativa. "Golpeado" apunta a transferencia o caída; "aplastado" apunta a estiba, altura de pallet o ajuste de la encajadora. Son diagnósticos con acciones correctivas distintas.

**Reglas de negocio**

1. **El denominador se persiste siempre.** No se guarda solo el porcentaje: se guardan los contadores y las unidades inspeccionadas de esa muestra. Si mañana cambia "unidades por caja" en el maestro del producto, los porcentajes históricos siguen siendo recomputables y siguen dando el mismo número que el día que se midió.
2. **Los porcentajes NO se guardan: se calculan.** Los tres porcentajes (grupo 1, grupo 2 y total) son derivados. En la pantalla los calcula el sistema en vivo; en Power BI se calculan en DAX sobre las columnas de contadores y de unidades inspeccionadas.
3. **El agregado es PONDERADO, nunca un promedio de porcentajes.** Se suma todo lo no conforme y se divide por la suma de unidades inspeccionadas. Ejemplo de por qué importa: 1 defecto en 10 unidades y 1 defecto en 90 unidades dan 2 en 100 = **2%** ponderado; promediando porcentajes daría (10% + 1,11%) / 2 = **5,56%**, un número que no significa nada. El denominador varía muestra a muestra, así que promediar porcentajes está mal por definición.
4. **"No muestreada = no registro".** Si una máquina estaba parada o en cambio de formato, esa máquina **no genera registro** para esa hora. Nunca se carga "0 defectos" con un denominador inventado: esa fila fantasma diluye el porcentaje del día hacia abajo y puede cruzar una muestra que estaba **fuera de spec** al lado de **conforme**. El motivo por el que falta la fila se asienta en las **notas** del registro de esa hora.
5. **Los 5 contadores son obligatorios.** Un campo vacío guardado como 0 haría pasar por conforme una muestra que nadie inspeccionó. Cuando efectivamente no hubo rotura, hay un botón **"Sin defectos"** que pone los 5 contadores en 0 de forma explícita — la diferencia entre "no hubo" y "no se miró" queda registrada.
6. **El panel de arriba se llama "Rotura del lote", no "del día"**, porque el agregado se filtra por el **lote activo**, no por fecha. Si la línea cambió de producto a mitad de jornada, mezclar los dos productos en un mismo porcentaje no representa nada. (Qué es "el día" cuando hay cambio de producto a mitad de jornada quedó como pregunta escalada a arquitectura — ver ADR-017.)
7. **Un denominador ausente o cero da "sin dato", nunca 0%.** "No se puede calcular" y "no hubo rotura" son cosas distintas; mostrar 0% cuando falta el denominador le diría al operario que la muestra está conforme.
8. Si no se pudo traer lo ya cargado en el lote (red de planta), el panel avisa que el agregado está **incompleto** en vez de mostrar un verde/ámbar sobre un denominador parcial.

**Tolerancias:** todavía **no hay ninguna cargada**. Los tres porcentajes ya existen como parámetros especificables, así que el usuario puede cargar los rangos reales desde `/maestro` cuando consiga la Especificación Técnica vigente (y la de Arcor para los SKU copacker). Mientras no exista spec, el formulario funciona igual en estado "sin spec"; cuando exista, muestra el rango en vivo. Como en todo el módulo, la spec **no bloquea el guardado** — el punto HACCP es registrar la desviación, no impedir que se cargue.

## Control Peso Alfajor + OPP

Peso del alfajor **ya envuelto en film OPP**, más la verificación de fechado de esos mismos paquetes. Un registro por hora.

**Qué se registra**

- **10 pesos** (exactamente 10 paquetes consecutivos), en gramos.
- **Cuántos de esos 10 paquetes tienen el fechado no conforme** (0 a 10).
- **Tipo de falla de fechado**, obligatorio solo si hay al menos un no conforme: ausente / ilegible / fecha incorrecta / lote incorrecto.
- **Observación** de fechado, opcional.
- El promedio de los 10 pesos **no se guarda**: se recalcula desde las mediciones. El producto no se elige en el formulario — sale del producto activo de la línea (ADR-012).

**Qué es y qué NO es este control**

- **Es un control de PROCESO:** sirve para ver el ajuste de la envolvedora y detectar deriva a lo largo del turno. La tolerancia es interna, por producto, y vive en las especificaciones editables desde `/maestro`.
- **NO es una verificación de contenido neto declarado.** El peso es **bruto**: incluye la tara del film OPP (contenido neto = bruto − tara). Como evidencia de contenido neto ante INAL o metrología legal **no alcanza**: faltarían la tara declarada, el peso nominal de rótulo, la identificación y verificación de la balanza usada, y el esquema de muestreo que exige el régimen legal (que no es "10 consecutivos por hora").
- Si algún día hace falta ese control legal, es un **punto de control separado**, y **su límite no lo define la planta**. No se mezcla acá.
- **No se solapa con "Control Peso Alfajor"** (12 mediciones, alfajor desnudo): son parámetros distintos sobre puntos de control distintos. Nota lateral útil: si ambos se toman en la misma hora, `peso OPP − peso alfajor` estima la tara del film.

**Regla de fechado — por qué no es un checkbox**

El fechado es **rotulado obligatorio, con tolerancia cero**: no tiene "porcentaje aceptable". Y ante una falla, la regla operativa es **RETENER todo lo producido desde la última verificación conforme**.

Por eso se registra **cuántos** fallaron y **de qué tipo**, no un sí/no: para poder dimensionar esa retención. 1 de 10 ilegible (ajustar el codificador) y 10 de 10 con fecha incorrecta (retención masiva, posible recall) son eventos cuyo costo difiere en órdenes de magnitud. El formulario lo dice explícitamente en pantalla cuando hay no conformes.

**Tolerancias:** igual que en rotura, el parámetro de peso del paquete con OPP ya existe pero **no hay ninguna spec cargada** — se carga desde `/maestro` cuando esté la ET vigente.

## Fechado de envase (punto de control RETIRADO)

El punto de control "Control Fechado de Envase" (`fechado_envase`) está **retirado**, no simplemente "inactivo": se siembra con `activo: false` y **no debe reactivarse**. No confundir este caso con los 4 puntos de control apagados por el **gate de rollout** (ver "Habilitación de puntos de control" arriba), que sí se van a habilitar: aquellos conservan su fila en `puntos_control_lineas` y este no.

**Por qué importa la distinción:** desde 2026-08-06 la verificación de fechado se registra dentro de "Control Peso Alfajor + OPP" (los mismos 10 paquetes que se pesan). Si alguien reactivara el punto de control viejo, el **mismo hecho de negocio** (¿el fechado está conforme?) podría vivir en dos schemas distintos al mismo tiempo. El resultado sería peor que un error visible: cualquier reporte de fechado saldría **incompleto**, con cada mitad internamente consistente — nada avisaría que falta la otra mitad.

El valor `fechado_envase` se conserva en el enum de tipos de formulario solo por compatibilidad con registros históricos. Si en el futuro se quiere un control de fechado independiente del peso, se decide de nuevo desde cero (no se reactiva este).

## Especificaciones de calidad por producto (desde 2026-07-21, ver ADR-015)

Además de las cotas físicas de cada formulario (rangos mínimos/máximos que impiden guardar un valor imposible), el módulo admin (`/maestro`, solo rol `admin`) permite cargar el **objetivo de calidad** de cada producto por punto de control y parámetro (ej. "peso de tapa: objetivo 15g, aceptación 14–16g, crítico 12–18g"). Cuando existe esa spec, los formularios de captura muestran en vivo si la medición está dentro de rango, fuera de aceptación o fuera del límite crítico — pero **nunca bloquean el guardado**: el objetivo de calidad es informativo, la única cota que impide guardar es la física del formulario.

- `temp_interna` (temperatura interna del producto a la salida del túnel) es un **PCC (Punto Crítico de Control) confirmado del plan HACCP** — sigue siendo obligatorio en el formulario, y el catálogo ya soporta cargarle una spec con `esCritico: true`, pero **todavía no hay ninguna spec cargada** para ese parámetro (falta la lista completa de PCC del plan HACCP, pendiente del usuario).
- Hoy solo hay una spec de ejemplo cargada (Alfajor Negro, peso 72–78g / crítico 68–82g). El resto de los rangos por producto (incluido TAPAS, rotura en encajado y peso con OPP) se cargan a demanda desde el módulo admin.
