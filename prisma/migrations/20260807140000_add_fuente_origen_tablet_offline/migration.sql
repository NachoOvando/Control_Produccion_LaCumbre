-- Valor nuevo en el enum `FuenteOrigen` para distinguir los registros que se
-- capturaron sin red y se subieron después.
--
-- Por qué se reusa `fuente_origen` en vez de agregar una columna booleana
-- `capturado_offline`: `FuenteOrigen` ya existe precisamente para responder "de
-- dónde vino este dato" y ya es el punto de extensión declarado para SCADA
-- (`scada_opcua`, `scada_mqtt`). Una columna aparte sería un segundo lugar donde
-- preguntar lo mismo.
--
-- Va en su PROPIA migración, separada de las columnas nuevas: en varias
-- versiones de Postgres un `ALTER TYPE ... ADD VALUE` no puede usarse en la
-- misma transacción que lo crea, y mezclarlo con un ALTER TABLE es pedir un
-- fallo raro en la migración de producción.

ALTER TYPE "FuenteOrigen" ADD VALUE IF NOT EXISTS 'tablet_offline';
