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
