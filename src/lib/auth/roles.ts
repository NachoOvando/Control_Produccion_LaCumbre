// Helper de chequeo de rol — evita que el mismo Set de roles permitidos se
// duplique (y diverja) entre el endpoint y la página que lo consume.
export const ROLES_SUPERVISION_CALIDAD = new Set(["admin", "jefe_planta", "supervisor_calidad"]);

export function tieneRol(rol: string | undefined, permitidos: Set<string>): boolean {
  return !!rol && permitidos.has(rol);
}
