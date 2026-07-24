import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "./validate-jsonb";

const schemaMultipleOf01 = {
  type: "object",
  required: ["valor"],
  additionalProperties: false,
  properties: { valor: { type: "number", multipleOf: 0.1 } },
};

describe("validateAgainstSchema — multipleOf y precisión de floats", () => {
  // Bug real de producción: Control Temperatura Condensación Túnel rechazaba
  // estos valores exactos con "must be multiple of 0.1" — 75.3/0.1 y 18.2/0.1
  // no dan un entero exacto en floats de JS.
  it("acepta valores de 1 decimal que fallan por ruido de punto flotante", () => {
    expect(validateAgainstSchema({ valor: 75.3 }, schemaMultipleOf01)).toEqual({ valid: true });
    expect(validateAgainstSchema({ valor: 18.2 }, schemaMultipleOf01)).toEqual({ valid: true });
    expect(validateAgainstSchema({ valor: 60.2 }, schemaMultipleOf01)).toEqual({ valid: true });
  });

  it("sigue rechazando un valor genuinamente no múltiplo de 0.1", () => {
    const res = validateAgainstSchema({ valor: 75.35 }, schemaMultipleOf01);
    expect(res.valid).toBe(false);
  });

  it("rechaza un tipo de dato incorrecto (no relacionado a multipleOf)", () => {
    const res = validateAgainstSchema({ valor: "75.3" }, schemaMultipleOf01);
    expect(res.valid).toBe(false);
  });
});
