/**
 * Tipos del dominio Calidad.
 * Derivados del schema Prisma pero expresados como tipos TS para uso en services y UI.
 */

export type PuntoControlResumen = {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipoFormulario: string;
  schemaJson: unknown;
  orden: number;
};

export type LineaConPuntosControl = {
  id: string;
  nombre: string;
  descripcion: string | null;
  puntosControl: PuntoControlResumen[];
};

export type RegistroCalidadInput = {
  puntoControlId: string;
  loteId: string;
  lineaProductivaId: string;
  responsableId: string;
  turnoId?: string | null;
  fuenteOrigen?: string;
  fecha: string;   // ISO date: YYYY-MM-DD
  hora: string;    // HH:mm:ss
  nroMuestra: number;
  filaProd?: number;
  notas?: string;
  data: Record<string, unknown>;
};

export type RegistroCalidadDetalle = {
  id: string;
  puntoControl: { id: string; nombre: string };
  lote: { id: string; numeroLote: string; producto: { sku: string; nombre: string } };
  lineaProductiva: { id: string; nombre: string };
  responsable: { id: string; nombre: string };
  turno: { id: string; nombre: string } | null;
  fuenteOrigen: string;
  fecha: Date;
  hora: Date;
  nroMuestra: number;
  filaProd: number | null;
  notas: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
};

// Especificación de calidad de un campo medido, ya resuelta para el producto
// activo y este punto de control (ADR-015). La usan los formularios de captura
// para mostrar el rango objetivo y marcar en vivo dentro/fuera de spec. Se
// vincula al campo del `data` por `campoData` (ej. "mediciones", "temp_ddl").
export type EspecCampo = {
  campoData: string;
  agregacion: "escalar" | "array_cada" | "array_promedio" | "derivado";
  parametroNombre: string;
  unidad: string;
  objetivo: number | null;
  aceptacionMin: number | null;
  aceptacionMax: number | null;
  criticoMin: number | null;
  criticoMax: number | null;
  esCritico: boolean;
};

// Producto/lote activo de una línea (LineaProduccionEstado) — reemplaza el
// <select> "Producto en producción" que antes se repetía en cada formulario.
export type ProductoActivoLinea = {
  loteId: string;
  numeroLote: string;
  productoId: string;
  productoNombre: string;
  // Familia del producto — única fuente del filtrado de PCs en la grilla y del
  // dispatch de formularios por familia (no hay filtro manual de familia en UI).
  familiaSlug: string;
  // Datos de maestro del producto que algunos forms usan para auto-completar
  // (ej. ProduccionDiariaForm: vencimiento PT, nomenclatura de lote PT).
  vidaUtilMeses: number | null;
  nomenclaturaLote: string | null;
  cajasPorPallet: number | null;
  activadoPorNombre: string;
  activadoEn: string; // ISO
  // Specs vigentes del producto para el punto de control en contexto (solo se
  // puebla en la page de captura; en el selector de producto va undefined).
  especificaciones?: EspecCampo[];
};

// Estructura del formulario "Defectos de Conformado" en la UI
export type FilaDefectosConformado = {
  filaProd: number;
  fistula: "Sin fístula" | "Fístula <1cm" | "Fístula >1cm" | null;
  barril: "Sin barril" | "Barril aprobado" | "Barril rechazado" | null;
  ventana: "Sin ventana" | "Ventana ≤1cm" | "Ventana 1-3cm" | "Ventana >5cm" | null;
  mal_baniado: boolean;
  peso_neto: number | null;
};

export type MuestraDefectosConformado = {
  nroMuestra: number;
  hora: string;
  notas: string;
  filas: FilaDefectosConformado[];
};
