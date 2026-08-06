// Derivados del control de rotura en encajado — lógica pura, sin dependencias de
// framework, testeable sin montar React ni levantar la DB.
//
// Los 3 porcentajes NO se persisten en `data`: se calculan acá para mostrarlos en
// vivo al capturar, y en Power BI se calculan en DAX sobre las columnas de
// contadores y `unidades_muestreadas` (que sí se persisten). Persistir un
// porcentaje precalculado sería peor: un AVERAGE sobre esa columna daría el
// promedio de porcentajes, que con denominador variable está mal (ver
// porcentajesRoturaAgregados).

export type CategoriaRotura =
  | "golpeado_rotura_menor"
  | "golpeado_rotura_mayor"
  | "aplastado_rotura_leve"
  | "aplastado_rotura_intermedia"
  | "aplastado_rotura_mayor";

export type ConteosRotura = Record<CategoriaRotura, number>;

// Los dos grupos de la Especificación Técnica: el papel agrupa las 5 categorías
// en "ET 5% (1)" y "ET 5% (2)". Las categorías se mantienen separadas en `data`
// (son diagnósticos con acciones correctivas distintas); el agrupamiento vive
// acá, no en el schema, para poder revisarlo sin migrar datos.
export const CATEGORIAS_GRUPO_1: readonly CategoriaRotura[] = ["golpeado_rotura_menor"];

export const CATEGORIAS_GRUPO_2: readonly CategoriaRotura[] = [
  "golpeado_rotura_mayor",
  "aplastado_rotura_leve",
  "aplastado_rotura_intermedia",
  "aplastado_rotura_mayor",
];

export const CATEGORIAS_ROTURA: readonly CategoriaRotura[] = [
  ...CATEGORIAS_GRUPO_1,
  ...CATEGORIAS_GRUPO_2,
];

export type TotalesRotura = {
  grupo1: number;
  grupo2: number;
  total: number;
};

export type PorcentajesRotura = {
  grupo1: number | null;
  grupo2: number | null;
  total: number | null;
};

function sumar(conteos: ConteosRotura, categorias: readonly CategoriaRotura[]): number {
  return categorias.reduce((acc, cat) => {
    const v = conteos[cat];
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}

export function totalesRotura(conteos: ConteosRotura): TotalesRotura {
  const grupo1 = sumar(conteos, CATEGORIAS_GRUPO_1);
  const grupo2 = sumar(conteos, CATEGORIAS_GRUPO_2);
  return { grupo1, grupo2, total: grupo1 + grupo2 };
}

// Un denominador no usable da null, NUNCA 0: "no se puede calcular" y "no hubo
// rotura" son cosas distintas, y mostrar 0% cuando falta el denominador le dice
// al operario que la muestra está conforme.
function esDenominadorUsable(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function pct(numerador: number, denominador: number): number {
  return (numerador / denominador) * 100;
}

export function porcentajesRotura(
  conteos: ConteosRotura,
  unidadesMuestreadas: number
): PorcentajesRotura {
  if (!esDenominadorUsable(unidadesMuestreadas)) {
    return { grupo1: null, grupo2: null, total: null };
  }
  const { grupo1, grupo2, total } = totalesRotura(conteos);
  return {
    grupo1: pct(grupo1, unidadesMuestreadas),
    grupo2: pct(grupo2, unidadesMuestreadas),
    total: pct(total, unidadesMuestreadas),
  };
}

export type MuestraRotura = {
  conteos: ConteosRotura;
  unidadesMuestreadas: number;
};

export type PorcentajesRoturaAgregados = PorcentajesRotura & {
  unidadesInspeccionadas: number;
  registros: number;
};

// Agregado del día/turno: PONDERADO — suma de no-OK sobre suma de unidades
// inspeccionadas. NUNCA el promedio de los porcentajes.
//
// El denominador es variable (caja incompleta, máquina no muestreada), así que
// promediar porcentajes sesga el resultado: {1 defecto en 10} y {1 defecto en 90}
// dan 2/100 = 2% ponderado, pero (10% + 1,11%)/2 = 5,56% promediado. El segundo
// número no significa nada.
//
// Las muestras con denominador no usable se EXCLUYEN: no aportan ni al numerador
// ni al denominador.
export function porcentajesRoturaAgregados(
  muestras: readonly MuestraRotura[]
): PorcentajesRoturaAgregados {
  const validas = muestras.filter((m) => esDenominadorUsable(m.unidadesMuestreadas));

  const unidadesInspeccionadas = validas.reduce((acc, m) => acc + m.unidadesMuestreadas, 0);

  if (!esDenominadorUsable(unidadesInspeccionadas)) {
    return {
      grupo1: null,
      grupo2: null,
      total: null,
      unidadesInspeccionadas: 0,
      registros: validas.length,
    };
  }

  const acumulado = validas.reduce(
    (acc, m) => {
      const t = totalesRotura(m.conteos);
      return { grupo1: acc.grupo1 + t.grupo1, grupo2: acc.grupo2 + t.grupo2 };
    },
    { grupo1: 0, grupo2: 0 }
  );

  return {
    grupo1: pct(acumulado.grupo1, unidadesInspeccionadas),
    grupo2: pct(acumulado.grupo2, unidadesInspeccionadas),
    total: pct(acumulado.grupo1 + acumulado.grupo2, unidadesInspeccionadas),
    unidadesInspeccionadas,
    registros: validas.length,
  };
}

// Lee los conteos desde el `data` JSONB de un registro ya guardado (o desde un
// payload en construcción). Lo que no es número finito cuenta como 0 — el schema
// ya garantiza los enteros en lo que se guardó; esto es para el camino de lectura.
export function conteosDesdeData(data: Record<string, unknown>): ConteosRotura {
  const leer = (cat: CategoriaRotura): number => {
    const v = data[cat];
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    golpeado_rotura_menor: leer("golpeado_rotura_menor"),
    golpeado_rotura_mayor: leer("golpeado_rotura_mayor"),
    aplastado_rotura_leve: leer("aplastado_rotura_leve"),
    aplastado_rotura_intermedia: leer("aplastado_rotura_intermedia"),
    aplastado_rotura_mayor: leer("aplastado_rotura_mayor"),
  };
}
