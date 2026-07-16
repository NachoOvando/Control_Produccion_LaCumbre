/**
 * Contratos de respuesta de la API.
 * Toda respuesta de /api/v1/... sigue este contrato.
 */

export type ApiSuccess<T> = {
  data: T;
};

export type ApiError = {
  error: string;
  code: string;
  details?: unknown;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function isApiError(res: ApiResponse<unknown>): res is ApiError {
  return "error" in res;
}
