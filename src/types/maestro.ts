// Tipos del módulo de administración del maestro (formas aplanadas que cruzan
// del Server Component al cliente — sin Decimal ni Date, solo primitivos).

export type LineaNegocio = "marca_propia" | "copacker_arcor" | "fason_terceros";
export type UnidadRendimiento = "unidades_hora" | "cajas_amasijo";
export type Agregacion = "escalar" | "array_cada" | "array_promedio" | "derivado";

export type ProductoRow = {
  id: string;
  sku: string | null;
  nombre: string;
  familiaId: string;
  marcaId: string;
  lineaProductivaId: string | null;
  gusto: string | null;
  pesoGramos: number | null;
  unidadesPorCaja: number | null;
  rendimientoTeorico: number | null;
  unidadRendimiento: UnidadRendimiento | null;
  cajasPorPallet: number | null;
  vidaUtilMeses: number | null;
  pesoMasaCrudaG: number | null;
  esSemielaborado: boolean;
  observaciones: string | null;
  activo: boolean;
  familiaNombre: string;
  marcaNombre: string;
};

export type MarcaRow = { id: string; nombre: string; lineaNegocio: LineaNegocio; activa: boolean };
export type FamiliaRow = { id: string; slug: string; nombre: string; activa: boolean };
export type ParametroRow = { id: string; clave: string; nombre: string; unidad: string };

export type BindingRow = {
  puntoControlId: string;
  puntoControlNombre: string;
  parametroId: string;
  parametroClave: string;
  parametroNombre: string;
  unidad: string;
  agregacion: Agregacion;
};

export type EspecRow = {
  id: string;
  productoId: string;
  puntoControlId: string;
  parametroId: string;
  objetivo: number | null;
  aceptacionMin: number | null;
  aceptacionMax: number | null;
  criticoMin: number | null;
  criticoMax: number | null;
  esCritico: boolean;
  version: number;
};
