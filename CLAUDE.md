# CLAUDE.md — Proyecto de Digitalización La Cumbre

## Exploración del codebase: usar Graphify primero

Este repo tiene un grafo de conocimiento local en `graphify-out/` (gitignoreado,
regenerable). **Antes de leer archivos completos para explorar o ubicar código**,
consultar el grafo — cuesta una fracción de los tokens:

- `graphify query "<pregunta>"` — búsqueda por traversal (agregar `--budget N`
  para acotar la salida, default 2000 tokens).
- `graphify explain "<símbolo>"` — un nodo y sus vecinos en lenguaje claro.
- `graphify affected "<símbolo>"` — qué se ve impactado si cambio X.
- `graphify-out/GRAPH_REPORT.md` — resumen general del grafo.

Regenerar tras cambios estructurales grandes (archivos nuevos/borrados,
refactors): `graphify update .` (local, sin LLM; usar `--force` si el rebuild
tiene menos nodos por código borrado). Leer archivos directamente sigue siendo
correcto cuando ya sabés exactamente qué archivo/líneas necesitás.

## Protocolo de agentes de control de código

Este repo tiene 6 subagentes definidos en `.claude/agents/`:
`scm-alimentos`, `arquitecto-industrial`, `backend-senior`, `frontend-ux`,
`seguridad-analista`, `documentador`.

**Regla para vos (agente principal):** no decidas "esto es muy chico,
no hace falta revisión" salvo que sea un cambio trivial (typo, comentario,
formato). Ante la duda, invocá el subagente correspondiente — el costo de
invocar de más es bajo, el costo de dejar pasar un problema estructural o
de seguridad no.

### Orden obligatorio para cualquier feature/fix que toque código real

0. Si el cambio introduce o modifica una **regla de negocio o lógica de
   planificación** (no solo código de soporte) — prioridad de pedidos,
   cálculo de insumos, stock de seguridad, reposición, capacidad de
   línea — → `scm-alimentos` primero, antes de cualquier decisión
   técnica. Si dice "No representa bien la operación real", no se pasa
   a arquitectura ni a código hasta ajustar la regla con el usuario.
1. Si el cambio es estructural (stack, patrones, modelo de datos core,
   integraciones externas) → `arquitecto-industrial` primero. Su
   aprobación es condición para seguir.
2. En paralelo o en el orden que corresponda según el cambio:
   `backend-senior` para código de backend, `frontend-ux` para UI.
   Ninguno de los dos puede contradecir una decisión estructural ya
   aprobada por el arquitecto — si encuentran un problema de diseño,
   lo reportan como "escalar a arquitecto-industrial", no lo resuelven
   por su cuenta.
3. `seguridad-analista` corre siempre al final, sobre el código ya
   funcional — incluso si nadie lo pidió explícitamente, si el cambio
   tocó auth, datos, credenciales, endpoints o dependencias. **Tiene
   veto absoluto**: un hallazgo crítico bloquea el cierre de la tarea
   sin excepción, aunque los demás ya hayan aprobado.
4. `documentador` entra al final, sobre código ya aprobado. Si al
   documentar encuentra que el código no coincide con lo esperado,
   reabre el tema (avisándote a vos, agente principal) en vez de
   documentar la inconsistencia como si fuera normal.

### Cómo pasar contexto entre subagentes

Los subagentes no se ven entre sí. Cuando invoques al segundo agente de
una cadena, incluí en el prompt el reporte final del agente anterior
(la sección de "Formato de salida" de cada uno) para que no arranque
de cero. Ejemplo de flujo:

```
0. Invocás scm-alimentos sobre la regla de negocio propuesta → si
   aprueba (con o sin ajustes), seguís. Si rechaza, se ajusta la regla
   con el usuario antes de tocar arquitectura o código.
1. Invocás arquitecto-industrial, pasándole el reporte de scm-alimentos
   como contexto → devuelve reporte con decisión y
   "Corresponde pasar a revisión de: Backend"
2. Invocás backend-senior, pasándole los reportes anteriores como
   contexto adicional en el prompt
3. backend-senior devuelve su reporte → invocás seguridad-analista
   pasándole todos los reportes anteriores
4. Si seguridad-analista aprueba (o aprueba con observaciones no
   críticas) → invocás documentador con el historial completo
```

### Qué hacer ante un veto de seguridad-analista

No se avanza. Se reporta al usuario el hallazgo crítico y el fix
sugerido, y se espera confirmación de que se corrigió antes de
continuar la cadena — no se documenta ni se da por cerrada la tarea.

## Contexto de negocio (para que cualquier subagente lo tenga presente)

La Cumbre es manufactura alimenticia con tres modelos de negocio en
simultáneo: copacker de exportación para Arcor (alfajores, estándares
de calidad de exportación), productos con marca propia, y fasón/maquila
para otras marcas. Líneas: alfajores (negro, blanco, maicena), masas,
budines, fideos (fideos: envasado y armado en La Cumbre, salsa en polvo
producida por copacker externo NutriSantiago). El sistema debe distinguir
línea de negocio desde el modelo de datos, no como parche.

Stack tecnológico: **no definido todavía** — es responsabilidad de
`arquitecto-industrial` proponerlo la primera vez que se toque el tema,
no asumirlo.

Integraciones: hoy ninguna con SAP. A futuro, PLC/SCADA de planta (OT).
Separación IT/OT no negociable en cualquier diseño que se apruebe.
