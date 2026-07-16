-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('admin', 'jefe_planta', 'gerencia', 'supervisor_calidad', 'operador_calidad', 'supervisor_produccion', 'operador_produccion', 'supervisor_deposito', 'operador_deposito', 'compras');

-- CreateEnum
CREATE TYPE "LineaNegocio" AS ENUM ('marca_propia', 'copacker_arcor', 'fason_terceros');

-- CreateEnum
CREATE TYPE "UnidadRendimiento" AS ENUM ('unidades_hora', 'cajas_amasijo');

-- CreateEnum
CREATE TYPE "EstadoLote" AS ENUM ('en_produccion', 'en_espera', 'aprobado', 'rechazado', 'en_cuarentena');

-- CreateEnum
CREATE TYPE "EstadoOP" AS ENUM ('planificada', 'en_ejecucion', 'completada', 'cerrada', 'cancelada');

-- CreateEnum
CREATE TYPE "ModuloApp" AS ENUM ('calidad', 'produccion', 'deposito');

-- CreateEnum
CREATE TYPE "TipoFormulario" AS ENUM ('defectos_conformado', 'peso_relleno', 'peso_alfajor', 'peso_bano', 'inspeccion_visual', 'temperatura_condensacion', 'temperatura_tanques', 'detector_metales', 'fechado_envase', 'produccion_diaria', 'trazabilidad_insumos', 'generico');

-- CreateEnum
CREATE TYPE "FuenteOrigen" AS ENUM ('tablet', 'api_externa', 'scada_opcua', 'scada_mqtt', 'importacion');

-- CreateEnum
CREATE TYPE "AccionAuditoria" AS ENUM ('crear', 'modificar', 'eliminar', 'restaurar');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'operador_calidad',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "hora_inicio" TEXT NOT NULL,
    "hora_fin" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marcas" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "linea_negocio" "LineaNegocio" NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marcas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "familias" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "familias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puntos_control_familias" (
    "punto_control_id" UUID NOT NULL,
    "familia_id" UUID NOT NULL,

    CONSTRAINT "puntos_control_familias_pkey" PRIMARY KEY ("punto_control_id","familia_id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" UUID NOT NULL,
    "sku" TEXT,
    "nombre" TEXT NOT NULL,
    "familia_id" UUID NOT NULL,
    "marca_id" UUID NOT NULL,
    "linea_productiva_id" UUID,
    "gusto" TEXT,
    "peso_gramos" DECIMAL(8,2),
    "unidades_por_caja" DECIMAL(8,2),
    "rendimiento_teorico" DECIMAL(10,2),
    "unidad_rendimiento" "UnidadRendimiento",
    "cajas_por_pallet" INTEGER,
    "vida_util_meses" INTEGER,
    "peso_masa_cruda_g" DECIMAL(8,2),
    "es_semielaborado" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "descripcion_vieja" TEXT,
    "nomenclatura_lote" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes" (
    "id" UUID NOT NULL,
    "numero_lote" TEXT NOT NULL,
    "producto_id" UUID NOT NULL,
    "orden_produccion_id" UUID,
    "fecha_produccion" DATE NOT NULL,
    "estado" "EstadoLote" NOT NULL DEFAULT 'en_produccion',
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_produccion" (
    "id" UUID NOT NULL,
    "numero_orden" TEXT NOT NULL,
    "fecha_planificada" DATE NOT NULL,
    "fecha_inicio" DATE,
    "fecha_cierre" DATE,
    "estado" "EstadoOP" NOT NULL DEFAULT 'planificada',
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordenes_produccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineas_productivas" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" INTEGER,
    "descripcion" TEXT,
    "modulo" "ModuloApp" NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lineas_productivas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ubicaciones" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "parent_id" UUID,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ubicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puntos_control" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "modulo" "ModuloApp" NOT NULL,
    "tipo_formulario" "TipoFormulario" NOT NULL DEFAULT 'generico',
    "schema_json" JSONB NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "puntos_control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puntos_control_lineas" (
    "punto_control_id" UUID NOT NULL,
    "linea_productiva_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "puntos_control_lineas_pkey" PRIMARY KEY ("punto_control_id","linea_productiva_id")
);

-- CreateTable
CREATE TABLE "registros_calidad" (
    "id" UUID NOT NULL,
    "punto_control_id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "linea_productiva_id" UUID NOT NULL,
    "responsable_id" UUID NOT NULL,
    "turno_id" UUID,
    "fuente_origen" "FuenteOrigen" NOT NULL DEFAULT 'tablet',
    "fecha" DATE NOT NULL,
    "hora" TIME(0) NOT NULL,
    "nro_muestra" INTEGER NOT NULL,
    "fila_prod" INTEGER,
    "notas" TEXT,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" UUID,

    CONSTRAINT "registros_calidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_registros" (
    "id" UUID NOT NULL,
    "registro_calidad_id" UUID NOT NULL,
    "accion" "AccionAuditoria" NOT NULL,
    "usuario_id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datos_antes" JSONB,
    "datos_despues" JSONB,
    "ip_origen" TEXT,
    "motivo" TEXT,

    CONSTRAINT "auditoria_registros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lote_estado_log" (
    "id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "estado_anterior" "EstadoLote" NOT NULL,
    "estado_nuevo" "EstadoLote" NOT NULL,
    "usuario_id" UUID NOT NULL,
    "motivo" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lote_estado_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_nombre_key" ON "turnos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "marcas_nombre_key" ON "marcas"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "familias_slug_key" ON "familias"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "familias_nombre_key" ON "familias"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "productos_sku_key" ON "productos"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "productos_nombre_key" ON "productos"("nombre");

-- CreateIndex
CREATE INDEX "productos_familia_id_idx" ON "productos"("familia_id");

-- CreateIndex
CREATE INDEX "productos_marca_id_idx" ON "productos"("marca_id");

-- CreateIndex
CREATE INDEX "productos_linea_productiva_id_idx" ON "productos"("linea_productiva_id");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_numero_lote_key" ON "lotes"("numero_lote");

-- CreateIndex
CREATE INDEX "lotes_producto_id_idx" ON "lotes"("producto_id");

-- CreateIndex
CREATE INDEX "lotes_estado_fecha_produccion_idx" ON "lotes"("estado", "fecha_produccion");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_produccion_numero_orden_key" ON "ordenes_produccion"("numero_orden");

-- CreateIndex
CREATE UNIQUE INDEX "lineas_productivas_nombre_key" ON "lineas_productivas"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "lineas_productivas_codigo_key" ON "lineas_productivas"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_codigo_key" ON "ubicaciones"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "puntos_control_nombre_key" ON "puntos_control"("nombre");

-- CreateIndex
CREATE INDEX "registros_calidad_punto_control_id_fecha_idx" ON "registros_calidad"("punto_control_id", "fecha");

-- CreateIndex
CREATE INDEX "registros_calidad_lote_id_idx" ON "registros_calidad"("lote_id");

-- CreateIndex
CREATE INDEX "registros_calidad_linea_productiva_id_fecha_idx" ON "registros_calidad"("linea_productiva_id", "fecha");

-- CreateIndex
CREATE INDEX "registros_calidad_turno_id_fecha_idx" ON "registros_calidad"("turno_id", "fecha");

-- CreateIndex
CREATE INDEX "registros_calidad_deleted_at_idx" ON "registros_calidad"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "registros_calidad_punto_control_id_lote_id_fecha_nro_muestr_key" ON "registros_calidad"("punto_control_id", "lote_id", "fecha", "nro_muestra", "fila_prod");

-- CreateIndex
CREATE INDEX "auditoria_registros_registro_calidad_id_idx" ON "auditoria_registros"("registro_calidad_id");

-- CreateIndex
CREATE INDEX "auditoria_registros_usuario_id_timestamp_idx" ON "auditoria_registros"("usuario_id", "timestamp");

-- CreateIndex
CREATE INDEX "lote_estado_log_lote_id_timestamp_idx" ON "lote_estado_log"("lote_id", "timestamp");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "puntos_control_familias" ADD CONSTRAINT "puntos_control_familias_punto_control_id_fkey" FOREIGN KEY ("punto_control_id") REFERENCES "puntos_control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "puntos_control_familias" ADD CONSTRAINT "puntos_control_familias_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "familias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "familias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_marca_id_fkey" FOREIGN KEY ("marca_id") REFERENCES "marcas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_linea_productiva_id_fkey" FOREIGN KEY ("linea_productiva_id") REFERENCES "lineas_productivas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_orden_produccion_id_fkey" FOREIGN KEY ("orden_produccion_id") REFERENCES "ordenes_produccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones" ADD CONSTRAINT "ubicaciones_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ubicaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "puntos_control_lineas" ADD CONSTRAINT "puntos_control_lineas_punto_control_id_fkey" FOREIGN KEY ("punto_control_id") REFERENCES "puntos_control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "puntos_control_lineas" ADD CONSTRAINT "puntos_control_lineas_linea_productiva_id_fkey" FOREIGN KEY ("linea_productiva_id") REFERENCES "lineas_productivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_calidad" ADD CONSTRAINT "registros_calidad_punto_control_id_fkey" FOREIGN KEY ("punto_control_id") REFERENCES "puntos_control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_calidad" ADD CONSTRAINT "registros_calidad_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_calidad" ADD CONSTRAINT "registros_calidad_linea_productiva_id_fkey" FOREIGN KEY ("linea_productiva_id") REFERENCES "lineas_productivas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_calidad" ADD CONSTRAINT "registros_calidad_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_calidad" ADD CONSTRAINT "registros_calidad_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_calidad" ADD CONSTRAINT "registros_calidad_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_registros" ADD CONSTRAINT "auditoria_registros_registro_calidad_id_fkey" FOREIGN KEY ("registro_calidad_id") REFERENCES "registros_calidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_registros" ADD CONSTRAINT "auditoria_registros_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_estado_log" ADD CONSTRAINT "lote_estado_log_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_estado_log" ADD CONSTRAINT "lote_estado_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
