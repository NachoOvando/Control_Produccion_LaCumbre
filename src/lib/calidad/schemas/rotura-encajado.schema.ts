// JSON Schema del punto de control "Control de Rotura en Encajado".
//
// Vive acá y no como const local de prisma/seed.ts a propósito: así el test
// (src/lib/calidad/schemas/schemas.test.ts) puede correr el MISMO schema que se
// siembra contra el payload literal que arma el formulario. Es la defensa contra
// la trampa histórica del repo — un schema que no coincide con el payload real
// causó "0 registros guardados" dos veces (ver ADR-016).
//
// MODELO DEL REGISTRO
//   Un registro por (máquina encajadora, hora). Las 2 máquinas de una misma hora
//   comparten `nroMuestra` y se distinguen por `filaProd` = 1|2 — mismo patrón
//   que los 12 picos dosificadores de "Defectos de Conformado".
//
//   NO se registra pallet ni envasador (decisión explícita del usuario). El
//   responsable se inyecta server-side desde la sesión, nunca viene del cliente.
//
//   `unidades_muestreadas` es el DENOMINADOR REAL de la muestra: default =
//   `unidadesPorCaja` del producto activo, pero editable porque la caja real a
//   veces está incompleta (fin de pallet, fin de amasijo). Se persiste SIEMPRE
//   para que los porcentajes históricos sigan siendo recomputables si mañana
//   cambia `unidadesPorCaja` en el maestro (mismo criterio de ventana temporal
//   que ADR-015).
//
//   Máquina no muestreada (parada, cambio de formato) NO genera registro. Nunca
//   se carga 0 defectos con un denominador inventado: eso diluye el porcentaje
//   del día hacia abajo y puede cruzar una muestra de "fuera de spec" a
//   "conforme" por una fila fantasma.
//
//   Los 3 porcentajes (grupo 1, grupo 2, total) son DERIVADOS y NO se persisten
//   — se calculan en src/lib/calidad/rotura-encajado.ts. Mandarlos en `data`
//   hace fallar la validación por `additionalProperties: false`.
//
// COTAS
//   Físicas y amplias a propósito ("¿esto es posible?"), no de calidad ("¿está
//   en spec?"). Las tolerancias viven en EspecificacionProducto y se muestran en
//   vivo sin bloquear el guardado: el punto HACCP es *registrar* la desviación,
//   no impedirla.
//
//   La relación cruzada "suma de defectos <= unidades_muestreadas" no se expresa
//   de forma legible en JSON Schema: se valida en el formulario.

export const schemaRoturaEncajado = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Rotura en Encajado",
  description:
    "Rotura por máquina encajadora y hora. Muestra de 1 caja: se cuentan las unidades no conformes en 5 categorías sobre unidades_muestreadas. Los porcentajes son derivados, no se persisten.",
  type: "object",
  required: [
    "maquina",
    "unidades_muestreadas",
    "golpeado_rotura_menor",
    "golpeado_rotura_mayor",
    "aplastado_rotura_leve",
    "aplastado_rotura_intermedia",
    "aplastado_rotura_mayor",
  ],
  additionalProperties: false,
  properties: {
    // Espeja filaProd, que ya es columna estructural de la vista analítica. Se
    // duplica en `data` para que la vista de Power BI sea legible sin joins.
    //
    // SIN `enum` a propósito: generate-views.ts devuelve TEXT para cualquier
    // propiedad que tenga `enum`, ANTES de mirar el `type` — con enum la
    // columna saldría TEXT en vez de INTEGER.
    maquina: {
      type: "integer",
      minimum: 1,
      maximum: 2,
      description: "Máquina encajadora (1 o 2). Espeja filaProd.",
    },
    // El techo es 5000 y no 1000 porque `Producto.unidadesPorCaja` es
    // Decimal(8,2) y hay formatos a granel con cientos de unidades por caja
    // (TAPAS). Con el techo en 1000, el default derivado del maestro para esos
    // SKU nacía fuera de schema y AJV rechazaba el batch entero con un error
    // genérico: el modo de falla "0 registros guardados" de ADR-016. El
    // formulario espeja este mismo techo para avisar antes de enviar.
    unidades_muestreadas: {
      type: "integer",
      minimum: 1,
      maximum: 5000,
      description:
        "Denominador de los porcentajes: unidades efectivamente inspeccionadas en esta caja/hora.",
    },
    // Las 5 categorías se mantienen separadas y no se colapsan: no son
    // granularidad decorativa. "Golpeado" apunta a transferencia o caída;
    // "aplastado" apunta a estiba, altura de pallet o ajuste de la encajadora.
    // Son diagnósticos con acciones correctivas distintas.
    golpeado_rotura_menor: {
      type: "integer",
      minimum: 0,
      maximum: 5000,
      description: "Grupo 1 — golpeado con rotura menor.",
    },
    golpeado_rotura_mayor: {
      type: "integer",
      minimum: 0,
      maximum: 5000,
      description: "Grupo 2 — golpeado con rotura mayor.",
    },
    aplastado_rotura_leve: {
      type: "integer",
      minimum: 0,
      maximum: 5000,
      description: "Grupo 2 — aplastado con rotura leve.",
    },
    aplastado_rotura_intermedia: {
      type: "integer",
      minimum: 0,
      maximum: 5000,
      description: "Grupo 2 — aplastado con rotura intermedia.",
    },
    aplastado_rotura_mayor: {
      type: "integer",
      minimum: 0,
      maximum: 5000,
      description: "Grupo 2 — aplastado con rotura mayor.",
    },
  },
} as const;
