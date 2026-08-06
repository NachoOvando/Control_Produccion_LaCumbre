// El test que mata la trampa histórica del repo: un `schema_json` que no coincide
// con el payload real del formulario causó "0 registros guardados" dos veces
// (vencimiento_pt con pattern MM/AAAA vs DD/MM/AA; el submodo Tapitas de ADR-016).
//
// Cada payload de acá está copiado del objeto `data` que arma el formulario
// correspondiente. Si alguien cambia el form o el schema y se desalinean, este
// test falla ANTES de que un operario pierda un turno de mediciones.
//
// Se usa validateAgainstSchema (la instancia de AJV configurada del service, con
// multipleOfPrecision: 9), no una instancia nueva: validar contra un AJV distinto
// del de producción no probaría nada.

import { describe, it, expect } from "vitest";
import { validateAgainstSchema } from "@/lib/validate-jsonb";
import { schemaRoturaEncajado } from "./rotura-encajado.schema";
import { schemaPesoAlfajorOpp } from "./peso-opp.schema";

// ── Rotura en encajado ───────────────────────────────────────────────────────
// Copiado de RoturaEncajadoForm: data = { maquina, unidades_muestreadas, ...conteos }

function payloadRotura(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    maquina: 1,
    unidades_muestreadas: 21,
    golpeado_rotura_menor: 1,
    golpeado_rotura_mayor: 0,
    aplastado_rotura_leve: 0,
    aplastado_rotura_intermedia: 0,
    aplastado_rotura_mayor: 0,
    ...patch,
  };
}

describe("schemaRoturaEncajado", () => {
  it("acepta el payload de la máquina 1 y el de la máquina 2", () => {
    expect(validateAgainstSchema(payloadRotura({ maquina: 1 }), schemaRoturaEncajado).valid).toBe(true);
    expect(validateAgainstSchema(payloadRotura({ maquina: 2 }), schemaRoturaEncajado).valid).toBe(true);
  });

  it("acepta una muestra sin ningún defecto", () => {
    const data = payloadRotura({ golpeado_rotura_menor: 0 });
    expect(validateAgainstSchema(data, schemaRoturaEncajado).valid).toBe(true);
  });

  it("acepta un denominador distinto de 21 (caja incompleta)", () => {
    expect(validateAgainstSchema(payloadRotura({ unidades_muestreadas: 12 }), schemaRoturaEncajado).valid).toBe(true);
  });

  it("rechaza si falta unidades_muestreadas — sin denominador no hay porcentaje", () => {
    const data = payloadRotura();
    delete data.unidades_muestreadas;
    expect(validateAgainstSchema(data, schemaRoturaEncajado).valid).toBe(false);
  });

  it.each([0, -1])("rechaza unidades_muestreadas = %s", (unidades) => {
    expect(validateAgainstSchema(payloadRotura({ unidades_muestreadas: unidades }), schemaRoturaEncajado).valid).toBe(false);
  });

  // El techo tiene que dar lugar a los formatos a granel del maestro
  // (Producto.unidadesPorCaja es Decimal(8,2) y hay cajas de cientos de
  // unidades). Con el techo en 1000, el default heredado para esos SKU nacía
  // fuera de schema y el batch se rechazaba entero.
  it("acepta un denominador grande, como el de un formato a granel", () => {
    expect(validateAgainstSchema(payloadRotura({ unidades_muestreadas: 752 }), schemaRoturaEncajado).valid).toBe(true);
    expect(validateAgainstSchema(payloadRotura({ unidades_muestreadas: 5000 }), schemaRoturaEncajado).valid).toBe(true);
  });

  it("rechaza un denominador por encima del techo — el form avisa antes de enviar", () => {
    expect(validateAgainstSchema(payloadRotura({ unidades_muestreadas: 5001 }), schemaRoturaEncajado).valid).toBe(false);
  });

  it("rechaza un contador negativo", () => {
    expect(validateAgainstSchema(payloadRotura({ aplastado_rotura_mayor: -1 }), schemaRoturaEncajado).valid).toBe(false);
  });

  it("rechaza contadores decimales — son unidades enteras", () => {
    expect(validateAgainstSchema(payloadRotura({ golpeado_rotura_menor: 1.5 }), schemaRoturaEncajado).valid).toBe(false);
  });

  it("rechaza una máquina fuera de 1-2", () => {
    expect(validateAgainstSchema(payloadRotura({ maquina: 3 }), schemaRoturaEncajado).valid).toBe(false);
    expect(validateAgainstSchema(payloadRotura({ maquina: 0 }), schemaRoturaEncajado).valid).toBe(false);
  });

  it("rechaza si falta alguna de las 5 categorías", () => {
    const data = payloadRotura();
    delete data.aplastado_rotura_leve;
    expect(validateAgainstSchema(data, schemaRoturaEncajado).valid).toBe(false);
  });

  // El error obvio al implementar: mandar el porcentaje calculado junto al resto.
  it("rechaza los porcentajes derivados en data (additionalProperties: false)", () => {
    expect(validateAgainstSchema(payloadRotura({ pct_rotura_total: 4.8 }), schemaRoturaEncajado).valid).toBe(false);
  });

  // Ver la nota del schema: `pallet_numero` lo sobrescribe el repository con el
  // correlativo asignado, así que ninguna clave de este control debe llamarse así.
  it("no declara pallet_numero", () => {
    expect(Object.keys(schemaRoturaEncajado.properties)).not.toContain("pallet_numero");
  });

  // generate-views.ts devuelve TEXT para cualquier propiedad con `enum`, antes de
  // mirar el `type`. Con enum, `maquina` saldría TEXT en vez de INTEGER.
  it("no usa enum en maquina, para que la vista la exponga como INTEGER", () => {
    expect(schemaRoturaEncajado.properties.maquina).not.toHaveProperty("enum");
    expect(schemaRoturaEncajado.properties.maquina.type).toBe("integer");
  });
});

// ── Peso Alfajor + OPP ───────────────────────────────────────────────────────
// Copiado de PesoOppForm: data = { mediciones, fechado_no_conformes, [fechado_tipo_falla], [fechado_observacion] }

function pesos(n = 10, valor = 47.3): number[] {
  return Array.from({ length: n }, () => valor);
}

function payloadOpp(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { mediciones: pesos(), fechado_no_conformes: 0, ...patch };
}

describe("schemaPesoAlfajorOpp", () => {
  it("acepta 10 mediciones con fechado conforme", () => {
    expect(validateAgainstSchema(payloadOpp(), schemaPesoAlfajorOpp).valid).toBe(true);
  });

  it.each([9, 11])("rechaza %s mediciones — son exactamente 10 paquetes", (n) => {
    expect(validateAgainstSchema(payloadOpp({ mediciones: pesos(n) }), schemaPesoAlfajorOpp).valid).toBe(false);
  });

  // Regresión de multipleOfPrecision: sin él, 47.3/0.1 da 472.99999999999994 en
  // floats de JS y AJV rechazaría un peso perfectamente válido.
  it("acepta pesos con un decimal (multipleOf 0.1 con la precisión configurada)", () => {
    const r = validateAgainstSchema(payloadOpp({ mediciones: pesos(10, 47.3) }), schemaPesoAlfajorOpp);
    expect(r.valid).toBe(true);
  });

  it("rechaza un peso con dos decimales", () => {
    expect(validateAgainstSchema(payloadOpp({ mediciones: pesos(10, 47.35) }), schemaPesoAlfajorOpp).valid).toBe(false);
  });

  it("rechaza un peso físicamente imposible", () => {
    expect(validateAgainstSchema(payloadOpp({ mediciones: pesos(10, 3000) }), schemaPesoAlfajorOpp).valid).toBe(false);
  });

  it("rechaza si falta fechado_no_conformes", () => {
    const data = payloadOpp();
    delete data.fechado_no_conformes;
    expect(validateAgainstSchema(data, schemaPesoAlfajorOpp).valid).toBe(false);
  });

  it("rechaza más de 10 paquetes no conformes sobre una muestra de 10", () => {
    expect(validateAgainstSchema(payloadOpp({ fechado_no_conformes: 11 }), schemaPesoAlfajorOpp).valid).toBe(false);
  });

  describe("condicional del tipo de falla (if/then)", () => {
    it("con 0 no conformes NO exige tipo de falla", () => {
      expect(validateAgainstSchema(payloadOpp({ fechado_no_conformes: 0 }), schemaPesoAlfajorOpp).valid).toBe(true);
    });

    it("con no conformes EXIGE el tipo de falla", () => {
      const r = validateAgainstSchema(payloadOpp({ fechado_no_conformes: 2 }), schemaPesoAlfajorOpp);
      expect(r.valid).toBe(false);
    });

    it.each(["ausente", "ilegible", "fecha_incorrecta", "lote_incorrecto"])(
      "acepta el tipo de falla '%s' junto a los no conformes",
      (tipo) => {
        const data = payloadOpp({ fechado_no_conformes: 2, fechado_tipo_falla: tipo });
        expect(validateAgainstSchema(data, schemaPesoAlfajorOpp).valid).toBe(true);
      }
    );

    it("rechaza un tipo de falla fuera del enum", () => {
      const data = payloadOpp({ fechado_no_conformes: 1, fechado_tipo_falla: "otro" });
      expect(validateAgainstSchema(data, schemaPesoAlfajorOpp).valid).toBe(false);
    });

    // Documenta por qué el formulario OMITE la clave en vez de mandar null: el
    // type es string, así que null no valida y daría 0 registros guardados.
    it("rechaza fechado_tipo_falla en null — el form debe omitir la clave", () => {
      const data = payloadOpp({ fechado_no_conformes: 0, fechado_tipo_falla: null });
      expect(validateAgainstSchema(data, schemaPesoAlfajorOpp).valid).toBe(false);
    });

    // Decisión consciente: no hay `else` prohibitivo. Un valor residual del form
    // no debe bloquear el guardado — ese es justo el modo de falla que ya pasó.
    it("tolera un tipo de falla residual con 0 no conformes en vez de rechazar el registro", () => {
      const data = payloadOpp({ fechado_no_conformes: 0, fechado_tipo_falla: "ilegible" });
      expect(validateAgainstSchema(data, schemaPesoAlfajorOpp).valid).toBe(true);
    });
  });

  it("acepta la observación de fechado y rechaza una más larga que el máximo", () => {
    const base = { fechado_no_conformes: 1, fechado_tipo_falla: "ilegible" };
    expect(
      validateAgainstSchema(payloadOpp({ ...base, fechado_observacion: "Codificador sucio" }), schemaPesoAlfajorOpp).valid
    ).toBe(true);
    expect(
      validateAgainstSchema(payloadOpp({ ...base, fechado_observacion: "x".repeat(301) }), schemaPesoAlfajorOpp).valid
    ).toBe(false);
  });

  // El promedio es derivado: se recalcula, no se persiste.
  it("rechaza el promedio en data (additionalProperties: false)", () => {
    expect(validateAgainstSchema(payloadOpp({ promedio: 47.3 }), schemaPesoAlfajorOpp).valid).toBe(false);
  });

  it("no declara pallet_numero", () => {
    expect(Object.keys(schemaPesoAlfajorOpp.properties)).not.toContain("pallet_numero");
  });
});
