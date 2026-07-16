-- AlterTable
ALTER TABLE "lotes" ADD COLUMN     "linea_productiva_id" UUID;

-- CreateTable
CREATE TABLE "linea_produccion_estado" (
    "linea_productiva_id" UUID NOT NULL,
    "lote_activo_id" UUID NOT NULL,
    "activado_por_id" UUID NOT NULL,
    "activado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linea_produccion_estado_pkey" PRIMARY KEY ("linea_productiva_id")
);

-- CreateTable
CREATE TABLE "linea_activacion_log" (
    "id" UUID NOT NULL,
    "linea_productiva_id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linea_activacion_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "linea_produccion_estado_lote_activo_id_key" ON "linea_produccion_estado"("lote_activo_id");

-- CreateIndex
CREATE INDEX "linea_activacion_log_linea_productiva_id_created_at_idx" ON "linea_activacion_log"("linea_productiva_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_producto_id_linea_productiva_id_fecha_produccion_key" ON "lotes"("producto_id", "linea_productiva_id", "fecha_produccion");

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_linea_productiva_id_fkey" FOREIGN KEY ("linea_productiva_id") REFERENCES "lineas_productivas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_produccion_estado" ADD CONSTRAINT "linea_produccion_estado_linea_productiva_id_fkey" FOREIGN KEY ("linea_productiva_id") REFERENCES "lineas_productivas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_produccion_estado" ADD CONSTRAINT "linea_produccion_estado_lote_activo_id_fkey" FOREIGN KEY ("lote_activo_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_produccion_estado" ADD CONSTRAINT "linea_produccion_estado_activado_por_id_fkey" FOREIGN KEY ("activado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_activacion_log" ADD CONSTRAINT "linea_activacion_log_linea_productiva_id_fkey" FOREIGN KEY ("linea_productiva_id") REFERENCES "lineas_productivas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_activacion_log" ADD CONSTRAINT "linea_activacion_log_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_activacion_log" ADD CONSTRAINT "linea_activacion_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
