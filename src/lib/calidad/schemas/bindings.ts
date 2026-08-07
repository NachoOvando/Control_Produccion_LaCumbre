/**
 * Bindings de especificaciones: en qué campo de `data` vive cada parámetro, por
 * punto de control, y cómo se agrega (ADR-015, tabla `puntos_control_parametros`).
 *
 * Esta tabla es la ÚNICA fuente: la consumen el seed (para persistirla) y
 * bindings-coherencia.test.ts (para validarla). Antes el seed la declaraba y el
 * test la replicaba a mano — se justificó como "el punto donde se nota la
 * desalineación", y esa apuesta salió mal: el test solo replicaba los bindings
 * de ADR-017, así que un binding roto de `peso_bano` vivió en producción sin que
 * nada lo señalara. Una fuente que se replica a mano no es un guardarraíl.
 *
 * Agregaciones:
 *   - `escalar`      → un valor único en `data`.
 *   - `array_cada`   → cada elemento del array se compara contra la misma spec.
 *   - `array_promedio` → se compara el promedio del array.
 *   - `derivado`     → el valor NO existe como clave de `data`: lo calcula un
 *                      módulo de lib/ y `campoData` es un nombre VIRTUAL.
 *
 * `derivado` NO significa "se evalúa al cierre" (corrección de ADR-017 a la
 * regla 6 de ADR-015): los pct_rotura_* se comparan en vivo mientras el operario
 * carga.
 */

import { schemaRoturaEncajado } from "./rotura-encajado.schema";
import { schemaPesoAlfajorOpp } from "./peso-opp.schema";
import {
  schemaPesoAlfajor,
  schemaPesoRelleno,
  schemaPesoBano,
  schemaPesoTapas,
  schemaTemperaturaTunelCondensacion,
  schemaTemperaturaTanques,
  schemaProduccionDiaria,
  schemaDefectosConformado,
} from "./puntos-control.schema";

export type Agregacion = "escalar" | "array_cada" | "array_promedio" | "derivado";

export type Binding = {
  /** Nombre del punto de control, tal como se siembra en `puntos_control.nombre` (unique). */
  pc: string;
  /** El schemaJson de ese punto de control, para poder validar `campoData`. */
  schema: { properties: Record<string, unknown> };
  /** `parametros.clave`. */
  clave: string;
  /** Clave real de `data`, o nombre virtual si `agregacion === "derivado"`. */
  campoData: string;
  agregacion: Agregacion;
};

// Nombres de los puntos de control que NO tienen ningún binding. El test verifica
// que siga siendo cierto: si a alguno se le agrega un binding, hay que mover su
// schema a puntos-control.schema.ts primero, o el guardarraíl no lo cubre.
export const PUNTOS_CONTROL_SIN_BINDINGS = [
  "Detector de Metales — Alfajor (PCC1)",
  "Control Fechado de Envase",
  "Trazabilidad Insumos",
  "Inspección Visual Masa",
] as const;

export const BINDINGS: Binding[] = [
  // ── Control Peso Alfajor ────────────────────────────────────────────────────
  {
    pc: "Control Peso Alfajor",
    schema: schemaPesoAlfajor,
    clave: "peso_alfajor",
    campoData: "mediciones",
    agregacion: "array_cada",
  },
  {
    pc: "Control Peso Alfajor",
    schema: schemaPesoAlfajor,
    clave: "peso_tapa",
    campoData: "peso_tapa",
    agregacion: "escalar",
  },

  // ── Control Peso Relleno ────────────────────────────────────────────────────
  {
    pc: "Control Peso Relleno",
    schema: schemaPesoRelleno,
    clave: "peso_relleno",
    campoData: "mediciones",
    agregacion: "array_cada",
  },

  // ── Control Peso Baño Alfajor ───────────────────────────────────────────────
  //
  // CORRECCIÓN (2026-08-07). Este binding decía `campoData: "mediciones"` con
  // `agregacion: "derivado"`, y era falso: `mediciones` SÍ es una clave real de
  // schemaPesoBano y contiene el peso del SANDWICH COMPLETO (cota 0-200 g), no
  // el del baño (~5-8 g). `derivado` enmascaraba la inconsistencia.
  //
  // Consecuencia si no se corregía: al cargar una spec de `peso_bano` para
  // Alfajor Negro, PesoMedicionesForm —que sí consulta la spec de `mediciones`—
  // habría comparado ~75 g contra un rango de ~5-8 g y marcado el 100% de la
  // producción fuera de crítico. El operario aprende en dos turnos que el
  // semáforo miente y deja de mirarlo.
  //
  // Ahora `campoData` es un nombre VIRTUAL: el peso del baño es la resta de
  // muestras apareadas (con baño − sin baño), no una clave de `data`. Eso lo
  // hace coherente con el invariante y, de paso, hace que el formulario NO
  // muestre un semáforo sobre el campo equivocado.
  {
    pc: "Control Peso Baño Alfajor",
    schema: schemaPesoBano,
    clave: "peso_bano",
    campoData: "peso_bano_calc",
    agregacion: "derivado",
  },
  {
    pc: "Control Peso Baño Alfajor",
    schema: schemaPesoBano,
    clave: "temp_bano",
    campoData: "temp_bano",
    agregacion: "escalar",
  },

  // ── Control Peso Tapas ──────────────────────────────────────────────────────
  // Mismos parámetros lógicos peso_tapa/temp_bano que Alfajor, bindeados a los
  // campos y agregación propios de este PC (ADR-015 — un Parametro admite un
  // binding por punto de control).
  {
    pc: "Control Peso Tapas",
    schema: schemaPesoTapas,
    clave: "peso_tapa",
    campoData: "mediciones_tapa",
    agregacion: "array_cada",
  },
  {
    pc: "Control Peso Tapas",
    schema: schemaPesoTapas,
    clave: "peso_cobertura",
    campoData: "mediciones_cobertura",
    agregacion: "array_cada",
  },
  {
    pc: "Control Peso Tapas",
    schema: schemaPesoTapas,
    clave: "temp_bano",
    campoData: "temp_bano",
    agregacion: "escalar",
  },

  // ── Control Temperatura Condensación Túnel ──────────────────────────────────
  {
    pc: "Control Temperatura Condensación Túnel",
    schema: schemaTemperaturaTunelCondensacion,
    clave: "temp_producto",
    campoData: "temp_producto",
    agregacion: "escalar",
  },
  {
    pc: "Control Temperatura Condensación Túnel",
    schema: schemaTemperaturaTunelCondensacion,
    clave: "temp_condensacion",
    campoData: "temp_condensacion",
    agregacion: "escalar",
  },
  {
    pc: "Control Temperatura Condensación Túnel",
    schema: schemaTemperaturaTunelCondensacion,
    clave: "humedad_relativa",
    campoData: "humedad_relativa",
    agregacion: "escalar",
  },
  {
    pc: "Control Temperatura Condensación Túnel",
    schema: schemaTemperaturaTunelCondensacion,
    clave: "temp_interna",
    campoData: "temp_interna",
    agregacion: "escalar",
  },

  // ── Control Temperatura Tanques ─────────────────────────────────────────────
  {
    pc: "Control Temperatura Tanques",
    schema: schemaTemperaturaTanques,
    clave: "temp_ddl",
    campoData: "temp_ddl",
    agregacion: "escalar",
  },
  {
    pc: "Control Temperatura Tanques",
    schema: schemaTemperaturaTanques,
    clave: "temp_bon_o_bon",
    campoData: "temp_bon_o_bon",
    agregacion: "escalar",
  },
  {
    pc: "Control Temperatura Tanques",
    schema: schemaTemperaturaTanques,
    clave: "temp_cobertura_1",
    campoData: "tanque_1_cobertura",
    agregacion: "escalar",
  },
  {
    pc: "Control Temperatura Tanques",
    schema: schemaTemperaturaTanques,
    clave: "temp_cobertura_2",
    campoData: "tanque_2_cobertura",
    agregacion: "escalar",
  },

  // ── Producción Diaria ───────────────────────────────────────────────────────
  {
    pc: "Producción Diaria — Línea 3",
    schema: schemaProduccionDiaria,
    clave: "peso_alfajor",
    campoData: "peso_alfajor",
    agregacion: "escalar",
  },

  // ── Defectos de Conformado ──────────────────────────────────────────────────
  //
  // CORRECCIÓN (2026-08-07), segundo binding roto que encontró el invariante
  // endurecido. Decía `campoData: "filas[].peso_neto"` con `array_cada`, y
  // schemaDefectosConformado NO tiene ninguna clave `filas`: `peso_neto` es un
  // escalar directo, y cada pico dosificador (1-12) es un REGISTRO SEPARADO
  // distinguido por la columna `filaProd`, no un elemento de un array dentro de
  // un registro.
  //
  // Estaba doblemente mal: la clave raíz no existía (el evaluador habría leído
  // undefined y salteado el parámetro en silencio, que es la falla que el
  // invariante existe para atrapar) y la agregación modelaba una estructura que
  // el schema nunca tuvo. Es también la razón por la que este binding era
  // huérfano en la UI: `specDeCampo` matchea por string exacto y ningún
  // formulario pide la spec de "filas[].peso_neto".
  {
    pc: "Defectos de Conformado",
    schema: schemaDefectosConformado,
    clave: "peso_neto",
    campoData: "peso_neto",
    agregacion: "escalar",
  },

  // ── Control de Rotura en Encajado (ADR-017) ─────────────────────────────────
  // campoData VIRTUAL: no hay tal clave en `data`. specDeCampo() matchea por
  // string sobre el array de especificaciones, no lee `data`, así que el
  // formulario le pasa el porcentaje ya calculado.
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

  // ── Control Peso Alfajor + OPP (ADR-017) ────────────────────────────────────
  {
    pc: "Control Peso Alfajor + OPP",
    schema: schemaPesoAlfajorOpp,
    clave: "peso_paquete_opp",
    campoData: "mediciones",
    agregacion: "array_cada",
  },
];

/**
 * Clave raíz real de `data` para un `campoData`. `filas[].peso_neto` → `filas`,
 * `temp_ddl` → `temp_ddl`.
 */
export function claveRaiz(campoData: string): string {
  return campoData.split("[]")[0].split(".")[0];
}

/** ¿`campoData` apunta a una clave declarada en el schema del punto de control? */
export function campoDataExisteEnSchema(binding: Binding): boolean {
  return Object.hasOwn(binding.schema.properties, claveRaiz(binding.campoData));
}
