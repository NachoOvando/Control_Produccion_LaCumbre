# Auditoría liviana — julio 2026

> Auditoría de estado sin subagentes (síntesis de la deuda ya identificada por la cadena de
> revisión en los ADRs + verificación puntual). Complementa, no reemplaza, a
> `architecture.md` (fuente de verdad de decisiones) y `LOG_CONTEXTO.md` (memoria de hitos).

## 1. Estado general

**Lo construido y verificado en browser contra Supabase real:**

- **Módulo Calidad completo y operativo**: 8 formularios de captura (pesos ×3, temperaturas ×2, defectos de conformado, detector de metales PCC1, producción diaria, trazabilidad de insumos), con numpad industrial táctil, registros del día, numeración de muestras continua y batch atómico con auditoría HACCP.
- **Producto activo por línea (ADR-012)**: asistente de 3 pasos (línea → producto → puntos de control), lote generado/reutilizado automáticamente (find-or-create con unique compuesto), estado compartido entre operarios (`LineaProduccionEstado`), historial append-only (`LineaActivacionLog`), guard anti-abuso (429), filtro de productos y de puntos de control derivados de la línea/producto elegidos.
- **Alta administrativa de lote (ADR-011)**: `POST /api/v1/calidad/lotes` gateado a supervisión, fuera de la navegación primaria.
- **Auth**: NextAuth con roles (6 usuarios seed), split Edge-safe, `creadoPorId`/`activadoPorId`/`responsableId` siempre server-side desde la sesión. Login demo corregido (2026-07-15): resuelve al usuario real cuando hay DB.
- **Datos**: maestro real importado (104 productos, 14 familias, 17 marcas), 3 migraciones versionadas, datos de prueba limpiados.
- **Documentación viva**: 12 ADRs, `api-reference.md`, `LOG_CONTEXTO.md` con hitos fechados.

**Arquitectura**: respeta las capas obligatorias del estándar global (componentes → services → repository → Prisma → Postgres). Patrón JSONB+JSON Schema (ADR-001) como decisión core. Sin desvíos estructurales detectados.

## 2. Deuda técnica consolidada (con origen)

Ordenada por prioridad de resolución, no por orden histórico.

### Antes de uso productivo real (bloqueantes de producción, no de desarrollo)

> **Actualización 2026-07-15 (mismo día, tarde):** #1 mitigada, #2 y #3 resueltas, #5 y #7 resueltas — ver detalle en cada fila y el hito correspondiente de `LOG_CONTEXTO.md`.

| # | Deuda | Origen | Por qué importa |
|---|-------|--------|-----------------|
| 1 | **Backups de Supabase** — **MITIGADA**: script manual `npm run db:backup` (`scripts/backup-db.ps1`, pg_dump a `backups/` gitignoreado). Pendiente: instalar PostgreSQL client tools en la máquina (el script lo indica si falta) y decidir plan Pro para backups automáticos. | LOG_CONTEXTO 2026-07-13 | Datos HACCP/exportación Arcor sin respaldo automático — el script manual requiere disciplina de ejecución. |
| 2 | ~~Guard de boot `DEMO_MODE` + producción~~ — **RESUELTA 2026-07-15**: `src/lib/auth.ts` lanza error al primer import si `NODE_ENV=production` y `DEMO_MODE=true`. | ADR-007 | — |
| 3 | ~~Rate limiting en `authorize()` (login)~~ — **RESUELTA 2026-07-15**: 5 intentos fallidos por email en 15 min bloquean el login (en memoria de proceso; si se escala horizontal, migrar a guard basado en DB). Verificado en browser. | seguridad-analista | — |
| 4 | **`DEMO_USER_PASSWORD` débil en `.env.local`** (`lacumbre2026`) — **acción del usuario** (archivo bloqueado para el agente): poner `DEMO_MODE="false"` (el login real funciona) o cambiar la password por un valor random. | seguridad-analista 2026-07-15 | Es de facto una segunda contraseña del usuario real. |

### Importantes, no urgentes

> **Actualización 2026-07-16:** #10 mitigada con residual, #11 resuelta, #12 con retención resuelta (cifrado sigue pendiente) — ver detalle en cada fila y el hito correspondiente de `LOG_CONTEXTO.md`.

| # | Deuda | Origen |
|---|-------|--------|
| 5 | ~~Validación server-side producto↔línea~~ — **RESUELTA 2026-07-15**: `PRODUCTO_LINEA_INCORRECTA` (409) en `linea-producto-activo.service.ts`; productos sin línea siguen activables en cualquiera. Verificado con POST directo + test unitario. | ADR-012, backend-senior |
| 6 | Fallbacks demo no gateados por `DEMO_MODE` (3 instancias en pages: `[puntoControlId]/page.tsx`, `lotes/nuevo/page.tsx`, `puntos-control/page.tsx`) — decisión de centralización pendiente de arquitecto-industrial | ADR-007 |
| 7 | ~~Cero tests automatizados~~ — **RESUELTA (base) 2026-07-15**: Vitest configurado (`npm test`), 28 tests en 5 suites (fecha-planta, lote-pt, lote.service, linea-producto-activo.service con guard anti-abuso, getTurnoByHora). Falta cobertura de repository con DB real y de componentes UI — crecer suite con cada feature nueva. | transversal |
| 8 | Rate limiting transversal en el resto de endpoints de escritura (login y activación ya cubiertos; alta de lote y registros no) | seguridad-analista, ADR-012 |
| 9 | ~~Reglas reales de numeración de lote~~ — **RESUELTA (2026-07-20)**: formato definitivo `L-DD/MM/AAAA-AJJJ-hh:mm-ENV` para el flujo automático de "producto activo por línea" (ver ADR-013 y el hito correspondiente de `LOG_CONTEXTO.md`). El placeholder `GEN-{fecha}-{hora}` queda solo para el alta manual sin línea (decisión explícita, no deuda). | ADR-011, ADR-013 |
| 10 | ~~Lockout DoS por email en el rate limiting de login~~ — **MITIGADA con residual (2026-07-16)**: se agregó log de detección (email+IP, solo en la transición al bloqueo, no por cada intento) y un contador por IP (`src/lib/auth/rate-limit-login.ts`) que marca "actividad sospechosa" a los 30 fallos/15min — pero ese contador por IP **NUNCA bloquea logins** (decisión deliberada tras hallazgo de `seguridad-analista`: en esta topología sin reverse proxy, `x-forwarded-for` es spoofeable por el cliente y los navegadores sin ese header comparten un bucket "desconocida" — bloquear por IP habría permitido tumbar el login de toda la planta con 30 requests). El bloqueo duro sigue siendo solo por email (5 fallos/15min, sin cambios respecto a antes). **Residual aceptado**: quien conoce el email de un tercero todavía puede bloquearlo 15 min — mitigado por la detección, no eliminado. | seguridad-analista 2026-07-15 |
| 11 | ~~Enumeración de usuarios por timing~~ en `authorize()` — **RESUELTA (2026-07-16)**: `src/lib/auth.ts` compara contra un hash bcrypt dummy (coste 12, igual al de `prisma/seed.ts`) cuando el usuario no existe o está inactivo, antes de rechazar — iguala el tiempo de respuesta con el camino de password incorrecta. Verificado empíricamente contra el dev server (tiempos de respuesta equivalentes en ambos casos). | seguridad-analista 2026-07-15 |
| 12 | Backups (`scripts/backup-db.ps1`) generan `.sql` sin cifrar en `backups/` — datos de producción/trazabilidad y hashes bcrypt en texto plano en disco. **Retención resuelta (2026-07-16), cifrado sigue pendiente por decisión explícita del usuario**: el script ahora conserva solo los 10 backups más recientes tras cada dump exitoso, borrando los más viejos. Gitignoreado; a futuro cifrar el dump (ej. `7z` con password) queda como deuda vigente. **La fuga de password de la connection string en la línea de comandos (hallazgo de un pase anterior) ya se corrigió** — el script usa `PGPASSWORD` vía entorno, no embebida en `--dbname`. | seguridad-analista 2026-07-15 |
| 13 | **Normalización de email en alta de usuarios** (nota surgida en la revisión de `seguridad-analista` del 2026-07-16, no bloqueante): `authorize()` ahora normaliza el email (`trim().toLowerCase()`) antes de usarlo para rate limiting y lookup en Prisma. Cuando exista alta de usuarios por pantalla, el service de creación **debe** aplicar la misma normalización antes de persistir en la columna `email` — si no, un usuario guardado con mayúsculas quedaría con lockout permanente (Postgres es case-sensitive). | seguridad-analista 2026-07-16 |
| 14 | **Maps en memoria sin límite de tamaño ni sweep** (nota surgida en la misma revisión, no bloqueante): `fallosPorEmail` y `fallosPorIp` en `src/lib/auth/rate-limit-login.ts` no tienen límite de tamaño ni sweep periódico — entradas vencidas solo se liberan al volver a consultar esa clave exacta. Riesgo bajo hoy (single-instance, LAN interna, se limpia con cada restart), documentado por si se decide agregar un sweep a futuro. | seguridad-analista 2026-07-16 |

### Para cuando crezca el alcance

| # | Deuda | Origen |
|---|-------|--------|
| 10 | BOM semielaborado → producto terminado (recall completo, consumo) | maestro v2 |
| 11 | Pantalla de admin del maestro (`Producto`/`Marca`/`Familia`) + auditoría append-only sobre el maestro cuando exista edición | ADR-010 |
| 12 | Pooler vs. conexión directa: al desplegar en serverless, volver al pooler para runtime y separar `DIRECT_URL` para migraciones | LOG_CONTEXTO 2026-07-13 |
| 13 | Estilos de card/botón duplicados en el asistente; mapeo de `json.error` a copy amigable; matriz consolidada de roles×acciones | frontend-ux / documentador |
| 14 | Riesgo teórico `Lote.creadoPorId onDelete: SetNull` si algún día hay borrado físico de usuarios (hoy es lógico vía `activo`) | ADR-011 |

## 3. Riesgos priorizados

1. **Pérdida de datos** (deuda #1): el único riesgo con daño irreversible. Todo lo demás es recuperable con código.
2. **Config de producción** (deudas #2-4): agrupadas, son "el modo demo no debe poder existir en prod". Resolución conjunta de ~1 hora.
3. **Integridad producto↔línea** (deuda #5): con la UI filtrando, el vector real es un script con sesión válida — improbable hoy, relevante cuando haya integraciones.
4. **Regresiones silenciosas** (deuda #7): sin tests, cada refactor depende de verificación manual en browser — costosa en tokens, que es exactamente lo que se quiere reducir.

## 4. Recomendaciones de ahorro de tokens

- **Cadena de revisión proporcional al cambio.** El CLAUDE.md ya exime cambios triviales. En la práctica de los últimos hitos, cambios mecánicos de UI pasaron por revisiones completas de 4 agentes. Criterio sugerido: subagentes solo cuando el cambio toca reglas de negocio, modelo de datos, auth/endpoints, o más de ~3 archivos con lógica; para lo demás, typecheck + verificación en browser alcanza.
- **Graphify para exploración** (instalado en este hito): consultar `graphify query`/`GRAPH_REPORT.md` antes de leer archivos completos; regenerar el grafo tras cambios estructurales.
- **`LOG_CONTEXTO.md` como memoria** (ya en uso): evita re-explicar decisiones en cada sesión. Mantener los hitos cortos — el archivo crece y se lee completo.
- **Un solo módulo activo** (este hito): menos superficie = menos código que revisar, testear y mantener por sesión.
- **Tests automatizados (deuda #7) son también ahorro de tokens**: cada verificación manual en browser cuesta una fracción significativa de sesión; un `npm test` cuesta cero.

## 5. Corrección de documentación aplicada en esta auditoría

- `architecture.md`: la deuda "selector sin filtrar por línea" seguía listada como pendiente pero se resolvió el 2026-07-14 — actualizada (la validación server-side sí sigue pendiente, deuda #5).
- `architecture.md`: la precondición del import mencionaba el nombre viejo `"Línea 3 — Conformado Alfajores"` — corregida a `"Línea 3"`.
