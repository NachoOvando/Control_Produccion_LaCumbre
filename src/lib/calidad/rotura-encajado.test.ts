import { describe, it, expect } from "vitest";
import {
  totalesRotura,
  porcentajesRotura,
  porcentajesRoturaAgregados,
  conteosDesdeData,
  CATEGORIAS_GRUPO_1,
  CATEGORIAS_GRUPO_2,
  type ConteosRotura,
} from "./rotura-encajado";

function conteos(patch: Partial<ConteosRotura> = {}): ConteosRotura {
  return {
    golpeado_rotura_menor: 0,
    golpeado_rotura_mayor: 0,
    aplastado_rotura_leve: 0,
    aplastado_rotura_intermedia: 0,
    aplastado_rotura_mayor: 0,
    ...patch,
  };
}

describe("agrupamiento de categorías", () => {
  it("el grupo 1 es solo golpeado-rotura menor y el grupo 2 son las otras cuatro", () => {
    expect(CATEGORIAS_GRUPO_1).toEqual(["golpeado_rotura_menor"]);
    expect(CATEGORIAS_GRUPO_2).toHaveLength(4);
    expect(CATEGORIAS_GRUPO_2).not.toContain("golpeado_rotura_menor");
  });
});

describe("totalesRotura", () => {
  it("suma cada grupo por separado y el total", () => {
    const t = totalesRotura(
      conteos({
        golpeado_rotura_menor: 3,
        golpeado_rotura_mayor: 1,
        aplastado_rotura_leve: 2,
        aplastado_rotura_intermedia: 0,
        aplastado_rotura_mayor: 4,
      })
    );
    expect(t.grupo1).toBe(3);
    expect(t.grupo2).toBe(7);
    expect(t.total).toBe(10);
  });

  it("todo en cero da cero", () => {
    expect(totalesRotura(conteos())).toEqual({ grupo1: 0, grupo2: 0, total: 0 });
  });
});

describe("porcentajesRotura", () => {
  it("calcula sobre las unidades inspeccionadas", () => {
    const p = porcentajesRotura(conteos({ golpeado_rotura_menor: 2 }), 24);
    expect(p.grupo1).toBeCloseTo(8.333, 3);
    expect(p.grupo2).toBe(0);
    expect(p.total).toBeCloseTo(8.333, 3);
  });

  it("sin defectos da 0%, NO null — la muestra se inspeccionó y salió conforme", () => {
    const p = porcentajesRotura(conteos(), 21);
    expect(p.grupo1).toBe(0);
    expect(p.grupo2).toBe(0);
    expect(p.total).toBe(0);
  });

  // Un denominador no usable no puede dar 0%: "no se puede calcular" y "no hubo
  // rotura" son cosas distintas, y mostrar 0% diría que la muestra está conforme.
  it.each([0, -5, NaN, Infinity])("denominador %s da null en los tres porcentajes", (denominador) => {
    const p = porcentajesRotura(conteos({ golpeado_rotura_menor: 2 }), denominador);
    expect(p).toEqual({ grupo1: null, grupo2: null, total: null });
  });
});

describe("porcentajesRoturaAgregados", () => {
  // El test que importa: con denominador variable, promediar porcentajes da un
  // número que no significa nada.
  it("pondera por unidades inspeccionadas, no promedia los porcentajes", () => {
    const a = porcentajesRoturaAgregados([
      { conteos: conteos({ golpeado_rotura_menor: 1 }), unidadesMuestreadas: 10 },
      { conteos: conteos({ golpeado_rotura_menor: 1 }), unidadesMuestreadas: 90 },
    ]);

    // Ponderado: 2 defectos sobre 100 unidades.
    expect(a.total).toBeCloseTo(2, 6);
    expect(a.grupo1).toBeCloseTo(2, 6);
    expect(a.unidadesInspeccionadas).toBe(100);
    expect(a.registros).toBe(2);

    // Promedio de porcentajes: (10% + 1,111%)/2 = 5,556%. No debe ser eso.
    expect(a.total).not.toBeCloseTo(5.5556, 3);
  });

  it("mezcla los dos grupos manteniendo el mismo denominador", () => {
    const a = porcentajesRoturaAgregados([
      { conteos: conteos({ golpeado_rotura_menor: 1, aplastado_rotura_mayor: 2 }), unidadesMuestreadas: 20 },
      { conteos: conteos({ golpeado_rotura_mayor: 1 }), unidadesMuestreadas: 30 },
    ]);
    expect(a.unidadesInspeccionadas).toBe(50);
    expect(a.grupo1).toBeCloseTo(2, 6); // 1/50
    expect(a.grupo2).toBeCloseTo(6, 6); // 3/50
    expect(a.total).toBeCloseTo(8, 6); // 4/50
  });

  it("excluye las muestras con denominador no usable — no aportan numerador ni denominador", () => {
    const a = porcentajesRoturaAgregados([
      { conteos: conteos({ golpeado_rotura_menor: 1 }), unidadesMuestreadas: 10 },
      { conteos: conteos({ golpeado_rotura_menor: 99 }), unidadesMuestreadas: 0 },
      { conteos: conteos({ golpeado_rotura_menor: 99 }), unidadesMuestreadas: NaN },
    ]);
    expect(a.unidadesInspeccionadas).toBe(10);
    expect(a.registros).toBe(1);
    expect(a.total).toBeCloseTo(10, 6);
  });

  it("sin muestras válidas da null y cero unidades", () => {
    expect(porcentajesRoturaAgregados([])).toEqual({
      grupo1: null,
      grupo2: null,
      total: null,
      unidadesInspeccionadas: 0,
      registros: 0,
    });
  });
});

describe("conteosDesdeData", () => {
  it("lee los 5 contadores del data JSONB", () => {
    const c = conteosDesdeData({
      maquina: 1,
      unidades_muestreadas: 21,
      golpeado_rotura_menor: 2,
      golpeado_rotura_mayor: 1,
      aplastado_rotura_leve: 0,
      aplastado_rotura_intermedia: 0,
      aplastado_rotura_mayor: 3,
    });
    expect(totalesRotura(c)).toEqual({ grupo1: 2, grupo2: 4, total: 6 });
  });

  it("lo que falta o no es número cuenta como 0", () => {
    const c = conteosDesdeData({ golpeado_rotura_menor: "x" });
    expect(totalesRotura(c).total).toBe(0);
  });
});
