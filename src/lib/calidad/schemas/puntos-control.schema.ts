/**
 * JSON Schemas de los puntos de control que TIENEN bindings de especificación
 * (`puntos_control_parametros`).
 *
 * Por qué viven acá y no en prisma/seed.ts, que es donde nacieron: el
 * guardarraíl de coherencia de bindings (bindings-coherencia.test.ts) necesita
 * importar el MISMO objeto que se siembra. Importar seed.ts no es opción —
 * ejecuta `main()` al cargarse. Mientras estos schemas fueron consts locales
 * del seed, el test solo pudo cubrir los 2 puntos de control de ADR-017, y por
 * esa rendija pasó un binding roto a producción: `peso_bano` apuntaba a
 * `mediciones`, que contiene el peso del sandwich completo (~75 g) y no el del
 * baño (~5-8 g). Ver ADR-017 §invariante de campoData.
 *
 * Los 4 schemas que NO están acá (DetectorMetales, FechadoEnvase,
 * TrazabilidadInsumos, InspeccionMasa) siguen en seed.ts porque no tienen
 * ningún binding. El test lo verifica explícitamente: si alguien les agrega un
 * binding, el test falla y obliga a mover el schema acá primero.
 *
 * Un archivo y no uno por punto de control (como sí hace ADR-017 con
 * rotura-encajado.schema.ts y peso-opp.schema.ts): estos 8 son los heredados,
 * se movieron en bloque sin reescribirlos, y separarlos en 8 archivos no agrega
 * nada. Los puntos de control NUEVOS siguen la convención de ADR-017.
 *
 * Contenido movido literalmente desde prisma/seed.ts, sin reescribir: el
 * `schemaJson` sembrado tiene que quedar idéntico.
 */

export const schemaPesoAlfajor = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Peso de Alfajor",
  description: "12 mediciones de peso de alfajor sin baño o con baño",
  type: "object",
  required: ["tipo", "mediciones"],
  additionalProperties: false,
  properties: {
    tipo: {
      type: "string",
      enum: ["sin_bano", "con_bano"],
      description: "Tipo de alfajor medido",
    },
    mediciones: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: {
        type: "number",
        minimum: 30,
        maximum: 150,
        multipleOf: 0.1,
      },
      description: "12 mediciones de peso en gramos",
    },
    peso_tapa: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
      description: "Peso de la tapa en gramos (opcional)",
    },
  },
};

export const schemaPesoRelleno = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Peso de Relleno",
  description: "12 mediciones de peso de relleno. Aplica a DDL, Bon o Bon u otro.",
  type: "object",
  required: ["tipo_relleno", "mediciones"],
  additionalProperties: false,
  properties: {
    tipo_relleno: {
      type: "string",
      enum: ["dulce_de_leche", "bonobon", "ddl_bob", "otros"],
      description: "Tipo de relleno controlado",
    },
    tipo_relleno_otro: {
      type: "string",
      maxLength: 100,
      description: "Aclaración cuando tipo_relleno = otros",
    },
    mediciones: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: {
        type: "number",
        minimum: 0,
        maximum: 150,
        multipleOf: 0.1,
      },
      description: "12 mediciones de peso de relleno en gramos",
    },
    peso_tapa: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
    },
    presencia_bob: {
      type: "boolean",
      description: "Presencia de BOB (Bon o Bon) — C/NC",
    },
    penetrometria: {
      type: "number",
      minimum: 0,
      maximum: 500,
      description: "Valor penetrométrico (opcional)",
    },
  },
};

export const schemaPesoBano = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Peso de Baño",
  description: "12 mediciones P1-P12. Registra T° ambiente y T° baño. Escurrimiento opcional (no se mide en cada muestra en la práctica de planta).",
  type: "object",
  required: ["tipo_producto", "mediciones", "temp_ambiente", "temp_bano"],
  additionalProperties: false,
  properties: {
    tipo_producto: {
      type: "string",
      // "Solo baño" no se mide: el peso del baño es la resta c/baño - s/baño (muestras apareadas)
      enum: ["sandwich_sin_bano", "sandwich_con_bano"],
      description: "Tipo de producto bañado",
    },
    mediciones: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: {
        type: "number",
        minimum: 0,
        maximum: 200,
        multipleOf: 0.1,
      },
      description: "12 mediciones de peso P1-P12 en gramos",
    },
    peso_tapa: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
    },
    temp_ambiente: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
      description: "Temperatura ambiente en °C",
    },
    temp_bano: {
      type: "number",
      minimum: 20,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura del baño de repostería en °C",
    },
    escurrimiento: {
      type: "number",
      minimum: 0,
      maximum: 100,
      multipleOf: 0.1,
      description: "Escurrimiento en gramos",
    },
  },
};

// Control Peso Tapas — PC propio y distinto de "Control Peso Baño Alfajor"
// (ver ADR-015, corrección 2026-07-21: el schema anterior compartido no
// aceptaba este payload y el guardado fallaba siempre — 0 registros
// guardados jamás). Cada observación (pico dosificador 1-12) pesa la MISMA
// tapa dos veces: sin bañar y con baño. La cobertura de chocolate se calcula
// en el cliente por resta apareada (con_baño[i] - sin_bañar[i]) y se envía
// ya calculada — NO hay una tercera medición manual de "baño suelto"
// (confirmado con el usuario: esa fila del diseño anterior no correspondía).
export const schemaPesoTapas = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Peso de Tapas",
  description: "12 observaciones (1 por pico dosificador). Cada una pesa la tapa sin bañar y con baño; la cobertura surge de la resta. T° ambiente y T° baño obligatorios, escurrimiento opcional.",
  type: "object",
  required: ["mediciones_tapa", "mediciones_tapa_con_bano", "mediciones_cobertura", "temp_ambiente", "temp_bano"],
  additionalProperties: false,
  properties: {
    mediciones_tapa: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: { type: "number", minimum: 0, maximum: 50, multipleOf: 0.1 },
      description: "12 pesos de tapa SIN bañar en gramos, uno por pico dosificador",
    },
    mediciones_tapa_con_bano: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: { type: "number", minimum: 0, maximum: 60, multipleOf: 0.1 },
      description: "12 pesos de tapa CON baño en gramos, mismo pico y orden que mediciones_tapa",
    },
    mediciones_cobertura: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      // Rango amplio (incluye negativos): esto es una cota de plausibilidad
      // física, no el rango de calidad — el objetivo de calidad vive en
      // EspecificacionProducto (ADR-014/015), no acá (ver ADR-001).
      items: { type: "number", minimum: -10, maximum: 30, multipleOf: 0.01 },
      description: "12 diferencias (con_baño - sin_bañar) en gramos, calculadas en el cliente",
    },
    temp_ambiente: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
      description: "Temperatura ambiente en °C",
    },
    temp_bano: {
      type: "number",
      minimum: 20,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura del baño de repostería en °C",
    },
    escurrimiento: {
      type: "number",
      minimum: 0,
      maximum: 100,
      multipleOf: 0.1,
      description: "Escurrimiento en gramos (opcional)",
    },
  },
};

export const schemaTemperaturaTunelCondensacion = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Temperatura de Condensación — Salida Túnel",
  description: "Control de temperatura y humedad a la salida del túnel de enfriado. Frecuencia: cada hora.",
  type: "object",
  required: [
    "humedad_relativa",
    "temp_ambiente",
    "temp_producto",
    "temp_rocio",
    "temp_condensacion",
    "temp_interna",
    "peso",
    "espesor",
  ],
  additionalProperties: false,
  properties: {
    humedad_relativa: {
      type: "number",
      minimum: 0,
      maximum: 100,
      multipleOf: 0.1,
      description: "Humedad relativa del ambiente en %",
    },
    temp_ambiente: {
      type: "number",
      minimum: -10,
      maximum: 50,
      multipleOf: 0.1,
      description: "Temperatura ambiente en °C",
    },
    temp_producto: {
      type: "number",
      minimum: -30,
      maximum: 40,
      multipleOf: 0.1,
      description: "Temperatura del producto a la salida del túnel en °C",
    },
    temp_rocio: {
      type: "number",
      minimum: -30,
      maximum: 40,
      multipleOf: 0.1,
      description: "Punto de rocío Td en °C",
    },
    temp_condensacion: {
      type: "number",
      minimum: -30,
      maximum: 40,
      multipleOf: 0.1,
      description: "Temperatura de condensación en °C",
    },
    temp_interna: {
      type: "number",
      minimum: -30,
      maximum: 40,
      multipleOf: 0.1,
      description: "Temperatura interna del producto en °C",
    },
    peso: {
      type: "number",
      minimum: 0,
      maximum: 300,
      multipleOf: 0.1,
      description: "Peso del producto en gramos",
    },
    espesor: {
      type: "number",
      minimum: 0,
      maximum: 100,
      multipleOf: 0.1,
      description: "Espesor del producto en mm",
    },
    tiempo_tunel_min: {
      type: "number",
      minimum: 0,
      maximum: 240,
      description: "Tiempo de túnel en minutos — se registra una vez por jornada",
    },
    observaciones: {
      type: "string",
      maxLength: 500,
    },
  },
};

export const schemaTemperaturaTanques = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Temperatura de Tanques",
  description: "Temperatura de los tanques de relleno y cobertura. Controles 3x por día.",
  type: "object",
  required: ["temp_ddl"],
  additionalProperties: false,
  properties: {
    temp_ddl: {
      type: "number",
      minimum: 10,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura Tanque DDL en °C",
    },
    temp_bon_o_bon: {
      type: "number",
      minimum: 10,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura Tanque Bon o Bon en °C",
    },
    tanque_1_cobertura: {
      type: "number",
      minimum: 20,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura Tanque 1 Cobertura en °C",
    },
    tanque_2_cobertura: {
      type: "number",
      minimum: 20,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura Tanque 2 Cobertura en °C",
    },
    observaciones: {
      type: "string",
      maxLength: 500,
    },
  },
};

export const schemaProduccionDiaria = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Producción Diaria",
  description: "Registro continuo de producción: cajas, pallets, lote producto terminado y peso.",
  type: "object",
  required: ["cajas", "lote_pt", "vencimiento_pt"],
  additionalProperties: false,
  properties: {
    cajas: {
      type: "integer",
      minimum: 0,
      maximum: 99999,
      description: "Cantidad de cajas producidas",
    },
    pallet_numero: {
      type: "integer",
      minimum: 1,
      description: "Número de pallet — correlativo automático por día",
    },
    pallet_incompleto: {
      type: "boolean",
      description: "El pallet quedó incompleto (se registran las cajas cargadas)",
    },
    tiempo_tunel_min: {
      type: "number",
      minimum: 0,
      maximum: 240,
      description: "Tiempo de túnel en minutos — se registra una vez por turno",
    },
    lote_pt: {
      type: "string",
      maxLength: 100,
      description: "Lote de producto terminado",
    },
    vencimiento_pt: {
      type: "string",
      // MM/AAAA (mes + año a 4 dígitos) — es lo que produce calcularVencimiento()
      // en src/lib/calidad/lote-pt.ts. El patrón DD/MM/AA que había acá era copia
      // del schema de fechado_envase (otro campo, otro formato) — nunca coincidió
      // con el valor real que manda el formulario, así que TODO guardado de
      // Producción Diaria fallaba con 400 desde que existe esta feature (0 filas
      // en producción, confirmado en DB). Ver hito de bug crítico en LOG_CONTEXTO.md.
      pattern: "^\\d{2}/\\d{4}$",
      description: "Fecha de vencimiento del lote PT en formato MM/AAAA",
    },
    peso_alfajor: {
      type: "number",
      minimum: 30,
      maximum: 150,
      multipleOf: 0.1,
      description: "Peso de alfajor chequeado en ese momento (opcional)",
    },
    zona_tunel_1: {
      type: "number",
      description: "Temperatura zona 1 del túnel (opcional)",
    },
    zona_tunel_2: {
      type: "number",
      description: "Temperatura zona 2 del túnel (opcional)",
    },
    zona_tunel_3: {
      type: "number",
      description: "Temperatura zona 3 del túnel (opcional)",
    },
    observaciones: {
      type: "string",
      maxLength: 500,
    },
  },
};

export const schemaDefectosConformado = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Defectos de Conformado",
  description: "Control de defectos visuales y gravimétricos en conformado de alfajores",
  type: "object",
  required: ["fistula", "barril", "ventana", "mal_baniado", "peso_neto"],
  additionalProperties: false,
  properties: {
    fistula: {
      type: "string",
      enum: ["Sin fístula", "Fístula <1cm", "Fístula >1cm"],
    },
    barril: {
      type: "string",
      enum: ["Sin barril", "Barril aprobado", "Barril rechazado"],
    },
    ventana: {
      type: "string",
      enum: ["Sin ventana", "Ventana ≤1cm", "Ventana 1-3cm", "Ventana >5cm"],
    },
    mal_baniado: {
      type: "boolean",
    },
    peso_neto: {
      type: "number",
      minimum: 60,
      maximum: 100,
      multipleOf: 0.1,
    },
  },
};
