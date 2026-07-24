/**
 * Validador dinámico de JSONB contra JSON Schema (draft-07) usando AJV.
 * Se usa en el service layer antes de persistir cualquier registro de calidad.
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";

// multipleOfPrecision: sin esto, AJV compara `valor / multipleOf` contra un
// entero exacto — 75.3/0.1 da 752.9999999999999 en floats de JS, así que un
// peso o temperatura perfectamente válido con 1 decimal (multipleOf: 0.1, el
// patrón usado en casi todos los schemas del maestro) se rechaza. Confirmado
// en producción: Control Temperatura Condensación Túnel rechazaba 75.3 y 18.2
// con "must be multiple of 0.1". Tolerancia 1e-9 — suficiente para el ruido de
// flotantes, insuficiente para dejar pasar un valor realmente inválido (ver
// validate-jsonb.test.ts).
const ajv = new Ajv({ allErrors: true, strict: false, multipleOfPrecision: 9 });
addFormats(ajv);

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

export function validateAgainstSchema(
  data: unknown,
  schema: unknown
): ValidationResult {
  const validate = ajv.compile(schema as object);
  const valid = validate(data);

  if (valid) return { valid: true };

  const errors = (validate.errors ?? []).map((err) => {
    const field = err.instancePath ? err.instancePath.replace(/^\//, "") : "raíz";
    return `Campo '${field}': ${err.message}`;
  });

  return { valid: false, errors };
}
