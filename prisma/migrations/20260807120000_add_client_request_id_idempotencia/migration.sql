-- Idempotencia del guardado de registros de calidad.
--
-- Problema que cierra (deuda escalada en ADR-017, sin resolver hasta ahora):
-- `POST /api/v1/calidad/registros/batch` no era idempotente. La transacción
-- commitea, el WiFi de planta se corta antes de que vuelva el 201, el operario
-- ve "Error de conexión. Verificá la red e intentá de nuevo" — el mensaje lo
-- invita a reintentar — y el reintento crea un segundo juego completo de
-- registros con `nro_muestra` consecutivo.
--
-- La constraint `registro_unico` (punto_control_id, lote_id, fecha,
-- nro_muestra, fila_prod) NO lo atrapa, porque el correlativo lo asigna el
-- servidor vía `secuencias_diarias`: el duplicado tiene un nro_muestra
-- distinto por diseño. En Control de Rotura en Encajado un duplicado puede
-- diluir una desviación real hacia "en spec".
--
-- `client_request_id` es la identidad del EVENTO de captura, generada en el
-- dispositivo (UUID v4) antes de enviar y estable entre reintentos.
--
-- Decisiones deliberadas:
--
--   * UNIQUE simple, NO parcial por `deleted_at`. Un evento de captura es
--     único para siempre: si un supervisor soft-borró el registro, un
--     reintento del mismo evento no debe recrearlo — sería revertir su
--     decisión en silencio. (Contrasta con `registros_calidad_pallet_unico`,
--     que sí es parcial: ahí el soft-delete libera el número de pallet.)
--
--   * NULLABLE. Los registros históricos no lo tienen y las escrituras
--     internas (seed, importaciones) no pasan por el camino del dispositivo.
--     En Postgres los NULL no colisionan entre sí en un índice único, así que
--     esta migración no puede fallar por datos preexistentes. Sin valor no hay
--     protección de idempotencia, que es exactamente el comportamiento previo.
--
--   * Se DESCARTA el índice único parcial que proponía ADR-017 sobre
--     (punto_control_id, lote_id, fecha, hora, fila_prod). No sirve:
--       - Falsos positivos: las 12 filas de `defectos_conformado` comparten
--         `hora` y difieren en `fila_prod`; los formularios de peso mandan
--         `fila_prod = NULL`; dos muestras M1/M2 enviadas en el mismo batch
--         con la misma hora colisionarían. Rechazaría registros HACCP
--         legítimos — y rechazar un registro es peor que duplicarlo.
--       - Falsos negativos: si el reintento recalcula `hora` en el cliente
--         (lo que pasa si el operario reintenta 40 s después), no atrapa nada.
--     No reintroducirlo.

ALTER TABLE "registros_calidad" ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "registros_calidad_client_request_id_key"
  ON "registros_calidad"("client_request_id");
