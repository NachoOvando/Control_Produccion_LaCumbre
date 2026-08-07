// Guardarraíl estructural sobre los bindings de especificaciones (ADR-015).
//
// `puntos_control_parametros.campo_data` significa dos cosas distintas según la
// fila: una clave REAL del `data` JSONB (`mediciones`, `temp_ddl`), o un
// identificador LÓGICO de un valor que no existe en `data` y lo calcula un
// módulo de lib/ (`pct_rotura_grupo1`). Nada en el modelo distingue los dos casos.
//
// EL INVARIANTE COMPLETO, en sus dos mitades:
//
//   (1) Si `campoData` NO es una clave declarada en el `schemaJson`, entonces
//       `agregacion` TIENE que ser `derivado`. Un binding con `campoData` mal
//       escrito y agregación `escalar`/`array_cada` apunta a una clave que nunca
//       existe: el evaluador leería `undefined` y saltearía ese parámetro en
//       silencio, incluidos los que tengan esCritico: true. Un evaluador HACCP
//       con falsos negativos silenciosos es peor que no tener evaluador.
//
//   (2) Si `campoData` SÍ es una clave declarada, entonces `agregacion` NO puede
//       ser `derivado`. Esta mitad faltaba, y por eso pasó a producción un
//       binding mentiroso: `peso_bano` apuntaba a `mediciones` con agregación
//       `derivado`. `mediciones` existe en schemaPesoBano y contiene el peso del
//       SANDWICH COMPLETO (cota 0-200 g), no el del baño (~5-8 g). `derivado`
//       enmascaraba la inconsistencia. Al cargar una spec de `peso_bano` para
//       Alfajor Negro se habría comparado ~75 g contra un rango de ~5-8 g,
//       marcando el 100% de la producción fuera de crítico.
//
// La otra causa de que (2) no se detectara: este test replicaba a mano los
// bindings del seed, y solo los 2 puntos de control de ADR-017. Ahora importa la
// MISMA tabla que siembra el seed (src/lib/calidad/schemas/bindings.ts). Una
// fuente que se replica a mano no es un guardarraíl.
//
// Es un test de coherencia sobre schemas y bindings declarados, no contra la DB:
// corre sin conexión.

import { describe, it, expect } from "vitest";
import {
  BINDINGS,
  PUNTOS_CONTROL_SIN_BINDINGS,
  claveRaiz,
  campoDataExisteEnSchema,
  type Binding,
} from "./bindings";
import { schemaRoturaEncajado } from "./rotura-encajado.schema";
import { schemaPesoAlfajorOpp } from "./peso-opp.schema";
import { schemaPesoBano } from "./puntos-control.schema";

describe("invariante de campoData — las dos mitades", () => {
  it.each(BINDINGS)(
    "$pc / $clave: campoData '$campoData' es clave real XOR la agregación es derivado",
    (b: Binding) => {
      const existe = campoDataExisteEnSchema(b);
      const esDerivado = b.agregacion === "derivado";

      // Las dos mitades son exactamente un XOR: una clave real nunca es
      // derivada, y una derivada nunca es clave real.
      expect(
        existe !== esDerivado,
        existe
          ? `'${b.campoData}' ES clave de ${b.pc}, así que la agregación no puede ser 'derivado' ` +
              `(sería un binding mentiroso: el parámetro '${b.clave}' no es lo que contiene ese campo)`
          : `'${b.campoData}' NO es clave de ${b.pc}, así que la agregación tiene que ser 'derivado' ` +
              `(hoy es '${b.agregacion}' y el evaluador leería undefined en silencio)`
      ).toBe(true);
    }
  );

  it("cubre TODOS los puntos de control que tienen bindings, no un subconjunto", () => {
    // Este es el test que faltaba. Mientras la cobertura era parcial, un binding
    // roto podía vivir en producción sin que nada lo señalara.
    const pcsCubiertos = new Set(BINDINGS.map((b) => b.pc));
    expect(pcsCubiertos.size).toBe(10);
    expect(BINDINGS.length).toBe(22);
  });

  it("ningún punto de control sin bindings aparece en la tabla", () => {
    // Si alguien le agrega un binding a uno de estos, tiene que mover su schema
    // a puntos-control.schema.ts primero — si no, el guardarraíl no lo cubre.
    for (const nombre of PUNTOS_CONTROL_SIN_BINDINGS) {
      expect(
        BINDINGS.some((b) => b.pc === nombre),
        `"${nombre}" está listado como sin bindings pero tiene uno. Mové su schema ` +
          `a puntos-control.schema.ts y sacalo de PUNTOS_CONTROL_SIN_BINDINGS.`
      ).toBe(false);
    }
  });

  it("un parámetro tiene a lo sumo un binding por punto de control", () => {
    // La PK de puntos_control_parametros es (puntoControlId, parametroId): un
    // duplicado acá haría que el upsert del seed sobreescriba en silencio y
    // quede el último, sin aviso.
    const vistos = new Set<string>();
    for (const b of BINDINGS) {
      const k = `${b.pc}|${b.clave}`;
      expect(vistos.has(k), `binding duplicado: ${k}`).toBe(false);
      vistos.add(k);
    }
  });
});

describe("regresión: el binding de peso_bano ya no es mentiroso", () => {
  it("peso_bano NO apunta a 'mediciones' (que es el sandwich completo)", () => {
    const b = BINDINGS.find((x) => x.pc === "Control Peso Baño Alfajor" && x.clave === "peso_bano");
    expect(b).toBeDefined();
    expect(b!.campoData).not.toBe("mediciones");
    expect(b!.agregacion).toBe("derivado");
    // Y su campoData tiene que ser virtual, o sea NO existir en el schema.
    expect(campoDataExisteEnSchema(b!)).toBe(false);
  });

  it("documenta por qué era peligroso: 'mediciones' de Peso Baño llega a 200 g", () => {
    // El peso del baño de un alfajor ronda los 5-8 g. Una spec de peso_bano
    // comparada contra este campo daría fuera de rango siempre.
    const mediciones = schemaPesoBano.properties.mediciones as { items: { maximum: number } };
    expect(mediciones.items.maximum).toBe(200);
  });
});

describe("los derivados no se persisten", () => {
  it("los 3 porcentajes de rotura NO existen como clave del data", () => {
    for (const clave of ["pct_rotura_grupo1", "pct_rotura_grupo2", "pct_rotura_total"]) {
      // El schema tiene additionalProperties: false, así que mandarlos
      // rechazaría el registro.
      expect(Object.hasOwn(schemaRoturaEncajado.properties, clave)).toBe(false);
      const binding = BINDINGS.find((b) => b.campoData === clave);
      expect(binding?.agregacion).toBe("derivado");
    }
  });

  it("el campoData virtual de peso_bano tampoco es una clave del data", () => {
    expect(Object.hasOwn(schemaPesoBano.properties, "peso_bano_calc")).toBe(false);
  });
});

describe("claveRaiz", () => {
  it("resuelve un path dentro de un array de objetos", () => {
    expect(claveRaiz("filas[].peso_neto")).toBe("filas");
  });

  it("deja una clave simple como está", () => {
    expect(claveRaiz("temp_ddl")).toBe("temp_ddl");
  });

  it("ya no queda ningún binding con path 'filas[]'", () => {
    // Regresión del segundo binding roto: `peso_neto` apuntaba a
    // "filas[].peso_neto" y schemaDefectosConformado no tiene clave `filas` —
    // cada pico es un registro separado, distinguido por la columna filaProd.
    expect(BINDINGS.filter((b) => b.campoData.includes("[]"))).toEqual([]);
  });

  it("peso_neto apunta a la clave escalar real del schema", () => {
    const b = BINDINGS.find((x) => x.pc === "Defectos de Conformado" && x.clave === "peso_neto");
    expect(b).toBeDefined();
    expect(b!.campoData).toBe("peso_neto");
    expect(b!.agregacion).toBe("escalar");
    expect(campoDataExisteEnSchema(b!)).toBe(true);
  });
});

// Cotas espejadas en constantes de los formularios. Si acá cambian y allá no, el
// operario recibe "1 registro(s) con datos inválidos" sin saber qué corregir.
describe("cotas de schema espejadas en los formularios", () => {
  it("PesoOppForm: PESO_MIN / PESO_MAX / PESO_DECIMALES", () => {
    const items = schemaPesoAlfajorOpp.properties.mediciones.items;
    expect(items.minimum).toBe(10);
    expect(items.maximum).toBe(500);
    expect(items.multipleOf).toBe(0.1);
  });

  it("RoturaEncajadoForm: MAX_UNIDADES", () => {
    expect(schemaRoturaEncajado.properties.unidades_muestreadas.maximum).toBe(5000);
    expect(schemaRoturaEncajado.properties.golpeado_rotura_menor.maximum).toBe(5000);
  });
});

// Contraejemplos: así se ven los dos errores que el invariante existe para
// atrapar. Si alguno de estos dejara de detectarse, el guardarraíl está roto.
describe("contraejemplos del invariante", () => {
  it("detecta un binding no-derivado apuntando a una clave inexistente (mitad 1)", () => {
    // Tipado como Binding (y no inferido) a propósito: con el literal narrowed,
    // TypeScript marca la comparación con "derivado" como imposible y el
    // contraejemplo no compilaría.
    const malo: Binding = {
      pc: "x",
      schema: schemaPesoAlfajorOpp,
      clave: "peso_paquete_opp",
      campoData: "medicionez",
      agregacion: "array_cada",
    };
    expect(campoDataExisteEnSchema(malo)).toBe(false);
    expect(malo.agregacion === "derivado").toBe(false);
    // existe(false) !== esDerivado(false) → false → el invariante lo rechaza.
    expect(campoDataExisteEnSchema(malo) !== (malo.agregacion === "derivado")).toBe(false);
  });

  it("detecta un binding derivado apuntando a una clave real (mitad 2 — el bug de peso_bano)", () => {
    const malo: Binding = {
      pc: "Control Peso Baño Alfajor",
      schema: schemaPesoBano,
      clave: "peso_bano",
      campoData: "mediciones",
      agregacion: "derivado",
    };
    expect(campoDataExisteEnSchema(malo)).toBe(true);
    // existe(true) !== esDerivado(true) → false → el invariante lo rechaza.
    expect(campoDataExisteEnSchema(malo) !== (malo.agregacion === "derivado")).toBe(false);
  });
});
