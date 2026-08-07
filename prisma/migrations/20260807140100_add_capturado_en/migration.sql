-- Instante real de captura de la muestra, con zona horaria.
--
-- `fecha` (DATE) y `hora` (TIME(0)) NO se tocan: siguen siendo la verdad de
-- captura para todo el reporting existente, las vistas de Power BI y los
-- ORDER BY. Esta columna las complementa, no las reemplaza.
--
-- Hace falta porque `hora` es TIME(0) sin zona: sirve para el reporte de planta
-- pero no permite calcular con precisión cuánto tardó un registro en
-- sincronizar. Con captura offline eso deja de ser un detalle: la hora que pone
-- la tablet es FALSIFICABLE, y una hora falsificable es peor para una auditoría
-- que una hora de sincronización honesta. Con `capturado_en` (timestamptz) y
-- `created_at` (hora del servidor al persistir) el desvío de reloj se calcula
-- en lectura: `created_at - capturado_en`.
--
-- Deliberadamente NO se agregan:
--   * `sincronizado_en` → es `created_at`, que ya existe.
--   * `desvio_reloj_segundos` → derivable de las dos de arriba. Y el umbral que
--     define "desvío sospechoso" (hoy 5 min) es política: si cambia, se quiere
--     poder reevaluar el histórico, no vivir con un flag congelado con el
--     criterio viejo.
--   * `capturado_offline` → lo cubre `fuente_origen = 'tablet_offline'`.
--
-- Nullable: los registros históricos no lo tienen y las escrituras internas
-- (seed, importaciones) no pasan por el camino del dispositivo.

ALTER TABLE "registros_calidad" ADD COLUMN "capturado_en" TIMESTAMPTZ;

-- Para la vista de pendientes/desvío de reloj del supervisor: filtra por los que
-- tienen instante de captura y ordena por él.
CREATE INDEX "registros_calidad_capturado_en_idx"
  ON "registros_calidad"("capturado_en")
  WHERE "capturado_en" IS NOT NULL;
