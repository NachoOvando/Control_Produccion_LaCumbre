// JSON Schema del punto de control "Control Peso Alfajor + OPP".
//
// Vive acá y no como const local de prisma/seed.ts por el mismo motivo que
// rotura-encajado.schema.ts: el test corre este mismo objeto contra el payload
// literal del formulario.
//
// QUÉ ES Y QUÉ NO ES
//   Peso BRUTO del alfajor ya envuelto en film OPP. Es un control de PROCESO
//   (ajuste de la envolvedora, detección de deriva), NO una verificación de
//   contenido neto declarado.
//
//   Esto importa: el paquete envuelto incluye la tara del film, así que
//   contenido neto = bruto - tara. Como evidencia de contenido neto ante INAL o
//   metrología legal NO alcanza — faltarían tara declarada, peso nominal de
//   rótulo, identificación y verificación de la balanza, y el esquema de
//   muestreo del régimen legal (que no es "10 consecutivos por hora"). Si algún
//   día hace falta ese control, es un punto de control SEPARADO. No se mezcla
//   acá, y su límite no lo define la planta.
//
//   Siendo de proceso, la tolerancia es interna por producto y vive en
//   EspecificacionProducto, editable desde /maestro.
//
//   El producto sale del producto activo de la línea (ADR-012), no se elige por
//   fila: la planilla de papel tenía una columna PRODUCTO, pero el sistema ya
//   resuelve eso con la activación de línea.
//
//   Distinto de "Control Peso Alfajor" (12 mediciones, alfajor desnudo): son
//   parámetros distintos sobre puntos de control distintos, no se solapan
//   (ADR-015 regla 1). Nota lateral: si ambos se toman en la misma hora,
//   peso_opp - peso_alfajor estima la tara del film.
//
//   El promedio NO se persiste: se recalcula desde `mediciones`.
//
// FECHADO
//   Se verifica el fechado de esos mismos 10 paquetes. No es un booleano a
//   propósito: el fechado no tiene "% aceptable" (es rotulado obligatorio,
//   tolerancia cero), y la regla operativa ante una falla es RETENER todo lo
//   producido desde la última verificación conforme. Para dimensionar esa
//   retención hace falta saber cuántos fallaron y de qué tipo — 1 de 10 ilegible
//   (ajustar codificador) y 10 de 10 con fecha incorrecta (retención masiva,
//   posible recall) son eventos con costos que difieren en órdenes de magnitud.

export const schemaPesoAlfajorOpp = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control Peso Alfajor + OPP",
  description:
    "Peso bruto del alfajor envuelto en film OPP (control de proceso, no de contenido neto legal) + verificación de fechado de los mismos 10 paquetes. Un registro por hora. El promedio no se persiste.",
  type: "object",
  required: ["mediciones", "fechado_no_conformes"],
  additionalProperties: false,
  properties: {
    mediciones: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "number",
        minimum: 10,
        maximum: 500,
        multipleOf: 0.1,
      },
      description: "Exactamente 10 pesos brutos (alfajor + film OPP) en gramos.",
    },
    fechado_no_conformes: {
      type: "integer",
      minimum: 0,
      maximum: 10,
      description:
        "Cantidad de paquetes con fechado no conforme sobre los 10 de la muestra.",
    },
    fechado_tipo_falla: {
      type: "string",
      enum: ["ausente", "ilegible", "fecha_incorrecta", "lote_incorrecto"],
      description:
        "Obligatorio solo si fechado_no_conformes >= 1 (ver if/then). Cuando es 0 la clave se OMITE del payload — nunca se manda null: el type es string y AJV rechazaría null, lo que daría 0 registros guardados.",
    },
    fechado_observacion: {
      type: "string",
      maxLength: 300,
    },
  },
  // Condicional de robustez: exige el tipo de falla cuando hay no conformes.
  //
  // El `required` DENTRO del `if` es imprescindible: sin él, un payload que no
  // trae la clave hace que el `if` pase en vacío y el `then` se aplique de más.
  //
  // A propósito NO hay un `else` que PROHÍBA fechado_tipo_falla cuando es 0: un
  // else prohibitivo convierte un valor residual del formulario en 0 registros
  // guardados, que es exactamente el modo de falla que ya nos pasó dos veces.
  // El formulario resetea el campo al bajar el contador a 0; el schema no
  // castiga si se le escapa uno.
  if: {
    required: ["fechado_no_conformes"],
    properties: { fechado_no_conformes: { minimum: 1 } },
  },
  then: { required: ["fechado_tipo_falla"] },
} as const;
