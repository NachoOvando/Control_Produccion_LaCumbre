-- AlterTable
ALTER TABLE "lotes" ADD COLUMN     "creado_por_id" UUID;

-- CreateIndex
CREATE INDEX "lotes_creado_por_id_idx" ON "lotes"("creado_por_id");

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
