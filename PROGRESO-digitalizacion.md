# Progreso — Proyecto Digitalización La Cumbre

> Con git local activo, el "qué se hizo" ya vive en `git log` — no lo
> dupliques acá. Este archivo es para lo que git NO captura: en qué estás
> pensando ahora, cuál es el próximo paso concreto, y qué está bloqueado.
> Actualizalo al cerrar cada sesión, antes de cortar.

**Última actualización:** 21/07/2026

## Enfoque actual
Recién cerrado (cadena completa scm-alimentos → arquitecto-industrial →
backend → frontend → seguridad, sin veto): módulo de administración del
maestro (Producto / Marca / Familia) + especificaciones de calidad por
producto, versionadas y append-only, con comparación medido-vs-estándar
en vivo en los formularios de captura (peso, temperatura, producción
diaria). Documentado como **ADR-015** en `docs/architecture.md`. Solo el
rol `admin` edita el maestro.

## Próximo paso
1. **Cargar specs reales por producto** junto con el área de Calidad — hoy
   solo hay una spec de prueba cargada (Alfajor Negro, peso 72–78 / crít
   68–82). El catálogo de 13 parámetros y sus bindings ya está sembrado;
   faltan los rangos por producto, que son dato de calidad y se cargan a
   demanda desde el módulo admin.
2. **Definir la lista real de PCC del plan HACCP** para marcar `esCritico`
   correctamente en las specs (dato pendiente del usuario). Sin esa lista,
   `esCritico` queda en `false` por defecto.
3. **Evaluar M1 antes de Arcor:** `auditoria_maestro` y `AuditoriaRegistro`
   son append-only solo a nivel aplicación; el rol de la app todavía tiene
   `UPDATE`/`DELETE` a nivel motor. Antes de entrar al circuito de
   exportación Arcor, aplicar `REVOKE UPDATE, DELETE` o triggers de bloqueo.
4. Deuda menor abierta (no bloqueante): rate limiting en los endpoints de
   escritura del maestro (B1); TOCTOU benigno en `verificarRefsProducto`
   (B2, da 500 en vez de 404/409 si una ref se borra en el medio).
5. Pendientes de arrastre previos: secuencias server-side para
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
<!-- Cualquier cosa que no encaje arriba pero no querés perder -->
