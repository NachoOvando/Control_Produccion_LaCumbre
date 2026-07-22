-- CreateEnum
CREATE TYPE "AgregacionParametro" AS ENUM ('escalar', 'array_cada', 'array_promedio', 'derivado');

-- CreateEnum
CREATE TYPE "EntidadMaestro" AS ENUM ('producto', 'marca', 'familia', 'especificacion_producto');

-- CreateTable
CREATE TABLE "parametros" (
    "id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puntos_control_parametros" (
    "punto_control_id" UUID NOT NULL,
    "parametro_id" UUID NOT NULL,
    "campo_data" TEXT NOT NULL,
    "agregacion" "AgregacionParametro" NOT NULL,

    CONSTRAINT "puntos_control_parametros_pkey" PRIMARY KEY ("punto_control_id","parametro_id")
);

-- CreateTable
CREATE TABLE "especificaciones_producto" (
    "id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "punto_control_id" UUID NOT NULL,
    "parametro_id" UUID NOT NULL,
    "objetivo" DECIMAL(10,4),
    "aceptacion_min" DECIMAL(10,4),
    "aceptacion_max" DECIMAL(10,4),
    "critico_min" DECIMAL(10,4),
    "critico_max" DECIMAL(10,4),
    "es_critico" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "vigente_desde" TIMESTAMPTZ(6) NOT NULL,
    "vigente_hasta" TIMESTAMPTZ(6),
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "especificaciones_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_maestro" (
    "id" UUID NOT NULL,
    "entidad" "EntidadMaestro" NOT NULL,
    "entidad_id" UUID NOT NULL,
    "accion" "AccionAuditoria" NOT NULL,
    "snapshot_antes" JSONB,
    "snapshot_despues" JSONB,
    "usuario_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_maestro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parametros_clave_key" ON "parametros"("clave");

-- CreateIndex
CREATE INDEX "especificaciones_producto_producto_id_punto_control_id_para_idx" ON "especificaciones_producto"("producto_id", "punto_control_id", "parametro_id", "vigente_desde");

-- CreateIndex
CREATE INDEX "auditoria_maestro_entidad_entidad_id_idx" ON "auditoria_maestro"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "auditoria_maestro_usuario_id_created_at_idx" ON "auditoria_maestro"("usuario_id", "created_at");

-- AddForeignKey
ALTER TABLE "puntos_control_parametros" ADD CONSTRAINT "puntos_control_parametros_punto_control_id_fkey" FOREIGN KEY ("punto_control_id") REFERENCES "puntos_control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "puntos_control_parametros" ADD CONSTRAINT "puntos_control_parametros_parametro_id_fkey" FOREIGN KEY ("parametro_id") REFERENCES "parametros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "especificaciones_producto" ADD CONSTRAINT "especificaciones_producto_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "especificaciones_producto" ADD CONSTRAINT "especificaciones_producto_punto_control_id_fkey" FOREIGN KEY ("punto_control_id") REFERENCES "puntos_control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "especificaciones_producto" ADD CONSTRAINT "especificaciones_producto_parametro_id_fkey" FOREIGN KEY ("parametro_id") REFERENCES "parametros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "especificaciones_producto" ADD CONSTRAINT "especificaciones_producto_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_maestro" ADD CONSTRAINT "auditoria_maestro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índice único PARCIAL: a lo sumo UNA especificación VIGENTE (vigente_hasta IS
-- NULL) por (producto, punto de control, parámetro). Prisma no expresa índices
-- parciales en el DSL — va en SQL crudo, mismo patrón que
-- registros_calidad_pallet_unico (ADR-006/ADR-014). Es la red de seguridad dura
-- del versionado append-only: aunque una transacción con bug intente abrir una
-- segunda versión vigente, Postgres la rechaza. Versiones cerradas
-- (vigente_hasta con valor) no cuentan, así que el historial no colisiona.
CREATE UNIQUE INDEX "especificaciones_producto_vigente_unica"
  ON "especificaciones_producto" ("producto_id", "punto_control_id", "parametro_id")
  WHERE "vigente_hasta" IS NULL;
