// Helper de chequeo de rol — evita que el mismo Set de roles permitidos se
// duplique (y diverja) entre el endpoint y la página que lo consume.
export const ROLES_SUPERVISION_CALIDAD = new Set(["admin", "jefe_planta", "supervisor_calidad"]);

// Administración del maestro (productos, marcas, familias, especificaciones):
// configuración crítica que afecta trazabilidad de exportación — restringida a
// admin por decisión del usuario (ADR-015). El resto de los roles solo consulta.
export const ROLES_ADMIN_MAESTRO = new Set(["admin"]);

export function tieneRol(rol: string | undefined, permitidos: Set<string>): boolean {
  return !!rol && permitidos.has(rol);
}
