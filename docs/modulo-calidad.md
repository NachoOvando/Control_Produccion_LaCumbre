# Módulo Calidad — Reglas de negocio

Reglas aprobadas por scm-alimentos. Este documento describe **qué** registra cada formulario y por qué; el **cómo** técnico está en `architecture.md` (ADRs) y `api-reference.md`.

## Regla transversal

Todos los formularios muestran, arriba o junto a la carga, **los registros ya cargados en el día** para ese punto de control y esa línea (vía GET de registros del día — ver `api-reference.md`). El operador siempre ve qué se registró antes en su turno.

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

## Fechado de envase

Punto de control **desactivado**: el control de fechado se hace en planilla física. El tipo de formulario `fechado_envase` se conserva en el sistema solo por compatibilidad con registros históricos.

## Especificaciones de calidad por producto (desde 2026-07-21, ver ADR-015)

Además de las cotas físicas de cada formulario (rangos mínimos/máximos que impiden guardar un valor imposible), el módulo admin (`/calidad/maestro`, solo rol `admin`) permite cargar el **objetivo de calidad** de cada producto por punto de control y parámetro (ej. "peso de tapa: objetivo 15g, aceptación 14–16g, crítico 12–18g"). Cuando existe esa spec, los formularios de captura muestran en vivo si la medición está dentro de rango, fuera de aceptación o fuera del límite crítico — pero **nunca bloquean el guardado**: el objetivo de calidad es informativo, la única cota que impide guardar es la física del formulario.

- `temp_interna` (temperatura interna del producto a la salida del túnel) es un **PCC (Punto Crítico de Control) confirmado del plan HACCP** — sigue siendo obligatorio en el formulario, y el catálogo ya soporta cargarle una spec con `esCritico: true`, pero **todavía no hay ninguna spec cargada** para ese parámetro (falta la lista completa de PCC del plan HACCP, pendiente del usuario).
- Hoy solo hay una spec de ejemplo cargada (Alfajor Negro, peso 72–78g / crítico 68–82g). El resto de los rangos por producto (incluido TAPAS) se cargan a demanda desde el módulo admin.
</content>
