# Progreso — Proyecto Digitalización La Cumbre

> Con git local activo, el "qué se hizo" ya vive en `git log` — no lo
> dupliques acá. Este archivo es para lo que git NO captura: en qué estás
> pensando ahora, cuál es el próximo paso concreto, y qué está bloqueado.
> Actualizalo al cerrar cada sesión, antes de cortar.

**Última actualización:** 21/07/2026

## Enfoque actual
Recién cerrado (cadena completa scm-alimentos → arquitecto-industrial →
implementación → seguridad-analista, sin veto, un hallazgo Alto corregido
en el camino): bug crítico de guardado en TAPAS + relevamiento de planillas
físicas reales de planta para ese producto. "Control Peso Baño Alfajor"
servía dos modos de UI (alfajor / tapitas) bajo un solo `schema_json`
compartido que nunca coincidió con el payload de tapitas — **0 registros
se guardaron jamás para TAPAS**. Se creó un punto de control propio
("Control Peso Tapas"), se corrigió el filtro de insumos de Trazabilidad
por familia, se reabrió la edición del campo "Lote PT" de Producción
Diaria (sugerido, ya no de solo lectura) y se ocultó "Peso del alfajor"
para familias que no son Alfajor Negro. Documentado como **ADR-016** en
`docs/architecture.md` (mismo día que ADR-015).

## Próximo paso
1. **Cargar `Producto.vidaUtilMeses` de TAPAS** desde `/calidad/maestro` —
   hoy bloquea la activación de TAPAS en Línea 3 con `409
   PRODUCTO_SIN_VIDA_UTIL` (ADR-013). Es de los 9/104 productos del
   maestro real sin ese dato.
2. **Cargar las `EspecificacionProducto` reales de TAPAS** (peso_tapa,
   peso_cobertura, temp_ambiente, temp_bano) — el catálogo de parámetros
   y los bindings ya están sembrados (15 parámetros, 18 bindings), falta
   el dato de calidad en sí.
3. **Definir la lista real de PCC del plan HACCP** — sigue pendiente de
   sesiones anteriores. Bloquea marcar `esCritico: true` en la spec de
   `temp_interna` (confirmado como PCC, pero sin spec cargada todavía) y
   en el resto de las specs.
4. **Probar end-to-end el guardado real de un registro en "Control Peso
   Tapas" contra la DB** — la verificación de esta sesión fue aislada
   (comparación de schema vs. payload, sin escritura) para no activar
   TAPAS en la línea real sin que el usuario lo pidiera. Recomendado
   hacerla la primera vez que se active TAPAS con el maestro completo.
5. **Evaluar M1 antes de Arcor:** `auditoria_maestro` y `AuditoriaRegistro`
   son append-only solo a nivel aplicación; el rol de la app todavía tiene
   `UPDATE`/`DELETE` a nivel motor. Antes de entrar al circuito de
   exportación Arcor, aplicar `REVOKE UPDATE, DELETE` o triggers de bloqueo.
6. Deuda menor abierta (no bloqueante): rate limiting en los endpoints de
   escritura del maestro (B1); TOCTOU benigno en `verificarRefsProducto`
   (B2, da 500 en vez de 404/409 si una ref se borra en el medio); sin
   recálculo server-side de la cobertura de tapas (mismo patrón aceptado
   que `peso_bano`); filtro de insumos por familia sin enforcement
   server-side; `lote_pt` sin `minLength`.
7. Pendientes de arrastre previos: secuencias server-side para
   pallet/muestra, RBAC por rol/línea, flujo formal de tratamiento de
   desviación de PCC (diferido; el modelo ya deja el lugar con
   `criticoMin/Max` + `esCritico`).

## Bloqueadores
Sin bloqueadores actuales.

## Notas sueltas
- Inconsistencia de numeración ADR-014→ADR-015 en comentarios de código:
  **CORREGIDA (2026-07-21).** Quedan dos "ADR-014" a propósito: `prisma.ts`
  (referencia legítima al pooler) y el comentario del SQL de la migración ya
  aplicada (no se edita para preservar el checksum de Prisma).
- `docs/LOG_CONTEXTO.md` tiene una nota agregada al pie del hito
  [2026-07-02] aclarando que el diseño viejo de "modo tapitas" descripto
  ahí quedó superado por ADR-016 — no usar ese hito como referencia del
  comportamiento actual.
<!-- Cualquier cosa que no encaje arriba pero no querés perder -->
</content>
