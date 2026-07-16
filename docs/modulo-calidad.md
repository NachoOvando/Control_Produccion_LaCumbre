# Módulo Calidad — Reglas de negocio

Reglas aprobadas por scm-alimentos. Este documento describe **qué** registra cada formulario y por qué; el **cómo** técnico está en `architecture.md` (ADRs) y `api-reference.md`.

## Regla transversal

Todos los formularios muestran, arriba o junto a la carga, **los registros ya cargados en el día** para ese punto de control y esa línea (vía GET de registros del día — ver `api-reference.md`). El operador siempre ve qué se registró antes en su turno.

## Producción Diaria

- **Pallet correlativo automático por día y por línea.** Hoy se calcula en el cliente a partir de los registros del día; el diseño objetivo lo asigna el servidor (ADR-006, pendiente).
- **Pallet incompleto:** se marca con un flag y se registra la cantidad de cajas.
- **Vencimiento:** derivado del producto (`vida_util_meses`): fecha de producción + meses, formato `MM/yyyy`. No lo tipea el operador.
- **Lote PT:** sugerido automáticamente según la `nomenclatura_lote` del producto (tokens `{yyyyMMdd}` / `{ddMMyy}` / `{correlativo}`).
- **Tiempo de túnel:** se registra **una vez por turno**; hay que volver a registrarlo si cambia la velocidad de la línea.

## Trazabilidad Insumos (Línea 3)

- Un registro por **cambio de lote de insumo**, no por turno.
- Insumos: tapas bañadas, Bon o Bon, dulce de leche, baño de chocolate. Campos: lote del insumo y observaciones opcionales.
- Objetivo: ante un recall, cruzar el horario del cambio de lote con los correlativos de pallet del día para acotar la mercadería afectada.

## Temperatura de tanques

Cuatro campos: **DDL**, **Bon o Bon**, **Cobertura 1**, **Cobertura 2**.

## Peso de relleno

Opciones de relleno: **Dulce de Leche**, **Bonobon**, **DDL + BoB**, **Otros** (con aclaración obligatoria).

## Peso del baño

No se pesa el baño directo: se calcula como el **promedio de restas apareadas** `P_i con baño − P_i sin baño`, entre la última muestra sin baño y la última con baño de la jornada. El tipo de producto "solo baño" fue eliminado.

## Fechado de envase

Punto de control **desactivado**: el control de fechado se hace en planilla física. El tipo de formulario `fechado_envase` se conserva en el sistema solo por compatibilidad con registros históricos.
