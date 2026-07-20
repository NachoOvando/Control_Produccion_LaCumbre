-- CreateTable
CREATE TABLE "secuencias_diarias" (
    "linea_productiva_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" TEXT NOT NULL,
    "ultimo_valor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "secuencias_diarias_pkey" PRIMARY KEY ("linea_productiva_id","fecha","tipo")
);

-- AddForeignKey
ALTER TABLE "secuencias_diarias" ADD CONSTRAINT "secuencias_diarias_linea_productiva_id_fkey" FOREIGN KEY ("linea_productiva_id") REFERENCES "lineas_productivas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (agregado a mano — Prisma no soporta índices funcionales en el DSL)
-- Defensa en profundidad (ADR-006): un pallet duplicado en la misma línea/día
-- es un dato de trazabilidad falso ante un recall. La protección primaria es
-- la asignación atómica vía secuencias_diarias; este índice es la red de
-- seguridad a nivel DB si algo, por lo que sea, la sortea.
CREATE UNIQUE INDEX "registros_calidad_pallet_unico" ON "registros_calidad" (
    "linea_productiva_id",
    "fecha",
    (("data" ->> 'pallet_numero'))
) WHERE "deleted_at" IS NULL;
