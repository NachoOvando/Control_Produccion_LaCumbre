/**
 * Validador dinámico de JSONB contra JSON Schema (draft-07) usando AJV.
 * Se usa en el service layer antes de persistir cualquier registro de calidad.
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
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
