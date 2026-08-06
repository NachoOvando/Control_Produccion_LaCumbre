// Guardarraíl estructural sobre los bindings de especificaciones (ADR-015).
//
// `puntos_control_parametros.campo_data` significa dos cosas distintas según la
// fila: una clave REAL del `data` JSONB (`mediciones`, `temp_ddl`), o un
// identificador LÓGICO de un valor que no existe en `data` y lo calcula un módulo
// de lib/ (`pct_rotura_grupo1`). Nada en el modelo distingue los dos casos.
//
// La invariante que este test protege: si `campoData` no corresponde a una clave
// declarada en el `schemaJson` del punto de control, entonces `agregacion` TIENE
// que ser `derivado`. Un binding con `campoData` mal escrito y agregación
// `escalar`/`array_cada` apunta a una clave que nunca existe: hoy no rompe nada
// visible, pero el día que se escriba el evaluador server-side de desvíos va a
// leer `undefined` y saltear ese parámetro en silencio — incluidos los que tengan
// esCritico: true. Un evaluador HACCP con falsos negativos silenciosos es peor
// que no tener evaluador.
//
// Es un test de coherencia sobre los schemas y los bindings declarados, no contra
// la DB: corre sin conexión.

import { describe, it, expect } from "vitest";
import { schemaRoturaEncajado } from "./rotura-encajado.schema";
import { schemaPesoAlfajorOpp } from "./peso-opp.schema";

type Agregacion = "escalar" | "array_cada" | "array_promedio" | "derivado";

// Los bindings de los 2 puntos de control nuevos, en el mismo orden y con los
// mismos valores que prisma/seed.ts. Si el seed cambia, este test tiene que
// cambiar con él — es intencional: es el punto donde se nota la desalineación.
const BINDINGS: {
  pc: string;
  schema: { properties: Record<string, unknown> };
  clave: string;
  campoData: string;
  agregacion: Agregacion;
}[] = [
  {
    pc: "Control de Rotura en Encajado",
    schema: schemaRoturaEncajado,
    clave: "pct_rotura_grupo1",
    campoData: "pct_rotura_grupo1",
    agregacion: "derivado",
  },
  {
    pc: "Control de Rotura en Encajado",
    schema: schemaRoturaEncajado,
    clave: "pct_rotura_grupo2",
    campoData: "pct_rotura_grupo2",
    agregacion: "derivado",
  },
  {
    pc: "Control de Rotura en Encajado",
    schema: schemaRoturaEncajado,
    clave: "pct_rotura_total",
    campoData: "pct_rotura_total",
    agregacion: "derivado",
  },
  {
    pc: "Control Peso Alfajor + OPP",
    schema: schemaPesoAlfajorOpp,
    clave: "peso_paquete_opp",
    campoData: "mediciones",
    agregacion: "array_cada",
  },
];

// "filas[].peso_neto" y similares apuntan dentro de un array de objetos: la parte
// antes de "[]" es la clave real del data.
function claveRaiz(campoData: string): string {
  return campoData.split("[]")[0].split(".")[0];
}

describe("coherencia de bindings de especificaciones", () => {
  it.each(BINDINGS)(
    "$pc / $clave: campoData '$campoData' existe en el schema, o la agregación es derivado",
    ({ schema, campoData, agregacion }) => {
      const existeEnSchema = Object.hasOwn(schema.properties, claveRaiz(campoData));
      if (!existeEnSchema) {
        expect(agregacion).toBe("derivado");
      } else {
        expect(existeEnSchema).toBe(true);
      }
    }
  );

  it("los 3 porcentajes de rotura son derivados y NO existen como clave del data", () => {
    for (const clave of ["pct_rotura_grupo1", "pct_rotura_grupo2", "pct_rotura_total"]) {
      // No deben persistirse: el schema tiene additionalProperties: false, así que
      // mandarlos rechazaría el registro.
      expect(Object.hasOwn(schemaRoturaEncajado.properties, clave)).toBe(false);
      const binding = BINDINGS.find((b) => b.campoData === clave);
      expect(binding?.agregacion).toBe("derivado");
    }
  });

  it("el binding de peso OPP apunta a una clave real del data", () => {
    expect(Object.hasOwn(schemaPesoAlfajorOpp.properties, "mediciones")).toBe(true);
  });

  // PesoOppForm espeja estas cotas en constantes propias (PESO_MIN / PESO_MAX /
  // PESO_DECIMALES) para poder señalar la celda exacta antes de enviar. Si acá
  // cambian y allá no, el operario vuelve a recibir "1 registro(s) con datos
  // inválidos" sin saber qué corregir.
  it("las cotas de mediciones del schema son las que espeja el formulario", () => {
    const items = schemaPesoAlfajorOpp.properties.mediciones.items;
    expect(items.minimum).toBe(10);
    expect(items.maximum).toBe(500);
    expect(items.multipleOf).toBe(0.1);
  });

  // Igual para el techo del denominador de rotura, espejado en MAX_UNIDADES.
  it("el techo de unidades_muestreadas y de los contadores es el que espeja el formulario", () => {
    expect(schemaRoturaEncajado.properties.unidades_muestreadas.maximum).toBe(5000);
    expect(schemaRoturaEncajado.properties.golpeado_rotura_menor.maximum).toBe(5000);
  });

  // Contraejemplo: así se vería un binding mal escrito, la clase de error que
  // este test existe para atrapar.
  it("detecta un binding no-derivado apuntando a una clave inexistente", () => {
    const malo = { campoData: "medicionez", agregacion: "array_cada" as Agregacion };
    const existe = Object.hasOwn(schemaPesoAlfajorOpp.properties, claveRaiz(malo.campoData));
    expect(existe).toBe(false);
    expect(malo.agregacion).not.toBe("derivado"); // → la invariante lo rechazaría
  });
});
