-- Dos puntos de control nuevos en el módulo Calidad (estación de encajado/envasado
-- de Línea 3): "Control de Rotura en Encajado" y "Control Peso Alfajor + OPP".
--
-- Migración ADITIVA y segura: solo declara dos valores nuevos en el enum. No
-- reescribe tablas, no toca filas existentes, no tiene rollback destructivo
-- (para revertir alcanza con no usar los valores).
--
-- A propósito NO hay ningún INSERT/UPDATE acá. Desde PG 12 el ADD VALUE sí puede
-- correr dentro de una transacción (y Prisma envuelve cada migración en una); lo
-- que NO se puede es USAR el valor nuevo en esa misma transacción. Las filas de
-- `puntos_control` que usan estos valores las siembra `npm run db:seed`, en otra
-- conexión.
--
-- Orden obligatorio, no recomendado: migrate → prisma generate → db:seed →
-- db:views. El seed referencia TipoFormulario.rotura_encajado, así que falla si
-- la migración no se aplicó.
--
-- IF NOT EXISTS para que sea idempotente si alguien ya agregó el valor a mano en
-- algún entorno (la restricción de mismo-transacción sigue igual).

-- AlterEnum
ALTER TYPE "TipoFormulario" ADD VALUE IF NOT EXISTS 'rotura_encajado';
ALTER TYPE "TipoFormulario" ADD VALUE IF NOT EXISTS 'peso_paquete_opp';
