/**
 * Generador programático de vistas analíticas SQL para Power BI
 * =============================================================
 *
 * PROPÓSITO:
 *   Separar el modelo de escritura (JSONB flexible) del modelo de lectura
 *   analítico (columnas planas, tipadas), sin acoplamiento manual.
 *
 * CÓMO FUNCIONA:
 *   1. Lee todos los `puntos_control` activos de la base de datos.
 *   2. Por cada uno, parsea su `schema_json` (JSON Schema draft-07).
 *   3. Genera DDL de una vista SQL que "aplana" los campos del JSONB a columnas reales.
 *   4. Ejecuta los CREATE OR REPLACE VIEW contra la base de datos.
 *   5. Genera también una vista de formato largo cruzando todos los puntos de control.
 *
 * CUÁNDO EJECUTAR:
 *   - Después de agregar un nuevo punto de control al seed/UI.
 *   - Nunca es necesario antes de eso: las vistas se crean bajo demanda.
 *   - Las vistas son de SOLO LECTURA. La app nunca escribe contra ellas.
 *
 * USO:
 *   npm run db:views
 *
 * CONEXIÓN POWER BI:
 *   Ver: docs/architecture.md#conexion-power-bi
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Mapeo de tipos JSON Schema → tipos PostgreSQL
function jsonTypeToPostgres(jsonSchema: Record<string, unknown>): string {
  const type = jsonSchema.type as string | undefined;
  const enumValues = jsonSchema.enum as unknown[] | undefined;

  if (enumValues) return "TEXT";

  switch (type) {
    case "string":
      return "TEXT";
    case "number":
      return "NUMERIC";
    case "integer":
      return "INTEGER";
    case "boolean":
      return "BOOLEAN";
    default:
      return "TEXT";
  }
}

// Sanitiza el nombre del punto de control para usarlo como nombre de vista SQL
function toViewName(nombre: string): string {
  return "vw_" +
    nombre
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")   // quita tildes
      .replace(/[^a-z0-9\s]/g, "")       // quita caracteres especiales
      .trim()
      .replace(/\s+/g, "_");             // reemplaza espacios con _
}

// Sanitiza un nombre de campo para columna SQL
function toColumnName(campo: string): string {
  return campo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]/g, "_");
}

// Genera el DDL de una vista "ancha" para un punto de control específico
function generateWideDDL(puntoControl: {
  id: string;
  nombre: string;
  schemaJson: unknown;
}): string {
  const schema = puntoControl.schemaJson as {
    properties?: Record<string, Record<string, unknown>>;
  };

  const properties = schema.properties ?? {};
  const viewName = toViewName(puntoControl.nombre);

  // Columnas estructurales fijas (siempre presentes en todas las vistas)
  const columnasFijas = `
    rc.id                                          AS registro_id,
    rc.fecha                                       AS fecha,
    rc.hora                                        AS hora,
    l.numero_lote                                  AS numero_lote,
    p.sku                                          AS producto_sku,
    p.nombre                                       AS producto_nombre,
    p.linea                                        AS linea_producto,
    p.tipo_cliente                                 AS tipo_cliente,
    lp.nombre                                      AS linea_productiva,
    u.nombre                                       AS responsable,
    rc.nro_muestra                                 AS nro_muestra,
    rc.fila_prod                                   AS fila_prod,
    rc.notas                                       AS notas,
    rc.created_at                                  AS creado_en`;

  // Columnas dinámicas del JSONB — una por campo del schema
  const columnasData = Object.entries(properties)
    .map(([campo, def]) => {
      const colName = toColumnName(campo);
      const pgType = jsonTypeToPostgres(def);
      // Extrae el campo del JSONB y lo castea al tipo correcto
      return `    (rc.data ->> '${campo}')::${pgType}          AS ${colName}`;
    })
    .join(",\n");

  return `
-- Vista analítica para: ${puntoControl.nombre}
-- Generada automáticamente por scripts/generate-views.ts
-- Leer: docs/architecture.md para entender el patrón de generación.
-- NO MODIFICAR MANUALMENTE — regenerar con: npm run db:views
CREATE OR REPLACE VIEW ${viewName} AS
SELECT
${columnasFijas},
${columnasData}
FROM registros_calidad rc
JOIN puntos_control    pc ON rc.punto_control_id    = pc.id
JOIN lotes             l  ON rc.lote_id             = l.id
JOIN productos         p  ON l.producto_id          = p.id
JOIN lineas_productivas lp ON rc.linea_productiva_id = lp.id
JOIN usuarios          u  ON rc.responsable_id      = u.id
WHERE pc.id = '${puntoControl.id}';

-- Índice de soporte para consultas por fecha desde Power BI
-- (Postgres crea índices en tablas, no vistas; este comentario es recordatorio)
-- CREATE INDEX IF NOT EXISTS idx_${viewName}_fecha ON registros_calidad(punto_control_id, fecha);
`.trim();
}

// Genera la vista de formato largo (un registro por campo) para análisis cruzados
function generateLongFormatDDL(): string {
  return `
-- Vista de formato largo: un registro por campo de cualquier punto de control
-- Útil para análisis cruzados en Power BI (comparar métricas entre puntos de control distintos).
-- Limitación: todos los valores son TEXT — hacer los castings en Power Query según necesidad.
CREATE OR REPLACE VIEW vw_calidad_formato_largo AS
SELECT
    rc.id                                    AS registro_id,
    pc.nombre                                AS punto_control,
    rc.fecha                                 AS fecha,
    rc.hora                                  AS hora,
    l.numero_lote                            AS numero_lote,
    p.sku                                    AS producto_sku,
    p.nombre                                 AS producto_nombre,
    p.linea                                  AS linea_producto,
    lp.nombre                                AS linea_productiva,
    u.nombre                                 AS responsable,
    rc.nro_muestra                           AS nro_muestra,
    rc.fila_prod                             AS fila_prod,
    kv.key                                   AS campo,
    kv.value                                 AS valor
FROM registros_calidad rc
JOIN puntos_control     pc ON rc.punto_control_id     = pc.id
JOIN lotes              l  ON rc.lote_id              = l.id
JOIN productos          p  ON l.producto_id           = p.id
JOIN lineas_productivas lp ON rc.linea_productiva_id  = lp.id
JOIN usuarios           u  ON rc.responsable_id       = u.id,
-- jsonb_each_text aplana el JSONB en filas (campo, valor)
LATERAL jsonb_each_text(rc.data) AS kv(key, value);
`.trim();
}

// Vista resumen: última muestra por lote y punto de control
function generateResumenUltimaMuestraDDL(): string {
  return `
-- Vista resumen: último registro por lote + punto de control
-- Útil para dashboards de estado actual en Power BI.
CREATE OR REPLACE VIEW vw_calidad_ultima_muestra AS
SELECT DISTINCT ON (rc.lote_id, rc.punto_control_id)
    rc.id                                    AS registro_id,
    pc.nombre                                AS punto_control,
    rc.fecha                                 AS fecha,
    rc.hora                                  AS hora,
    l.numero_lote                            AS numero_lote,
    p.sku                                    AS producto_sku,
    p.nombre                                 AS producto_nombre,
    lp.nombre                                AS linea_productiva,
    u.nombre                                 AS responsable,
    rc.nro_muestra                           AS nro_muestra,
    rc.data                                  AS data_jsonb
FROM registros_calidad rc
JOIN puntos_control     pc ON rc.punto_control_id     = pc.id
JOIN lotes              l  ON rc.lote_id              = l.id
JOIN productos          p  ON l.producto_id           = p.id
JOIN lineas_productivas lp ON rc.linea_productiva_id  = lp.id
JOIN usuarios           u  ON rc.responsable_id       = u.id
ORDER BY rc.lote_id, rc.punto_control_id, rc.fecha DESC, rc.hora DESC;
`.trim();
}

async function main() {
  console.log("🔧 Generando vistas analíticas...\n");

  const puntosControl = await prisma.puntoControl.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
  });

  if (puntosControl.length === 0) {
    console.log("⚠️  No hay puntos de control activos. Correr el seed primero: npm run db:seed");
    return;
  }

  // Generar y ejecutar vista por cada punto de control
  for (const pc of puntosControl) {
    const ddl = generateWideDDL(pc);
    const viewName = toViewName(pc.nombre);
    console.log(`📊 Generando vista: ${viewName}`);
    console.log(`   Punto de control: ${pc.nombre}`);

    try {
      await prisma.$executeRawUnsafe(ddl);
      console.log(`   ✅ ${viewName} creada/actualizada\n`);
    } catch (err) {
      console.error(`   ❌ Error al crear ${viewName}:`, err);
    }
  }

  // Vista formato largo
  console.log("📊 Generando vista: vw_calidad_formato_largo (análisis cruzados)");
  try {
    await prisma.$executeRawUnsafe(generateLongFormatDDL());
    console.log("   ✅ vw_calidad_formato_largo creada/actualizada\n");
  } catch (err) {
    console.error("   ❌ Error:", err);
  }

  // Vista resumen última muestra
  console.log("📊 Generando vista: vw_calidad_ultima_muestra (estado actual)");
  try {
    await prisma.$executeRawUnsafe(generateResumenUltimaMuestraDDL());
    console.log("   ✅ vw_calidad_ultima_muestra creada/actualizada\n");
  } catch (err) {
    console.error("   ❌ Error:", err);
  }

  console.log("🎉 Generación de vistas completada");
  console.log("\nVistas disponibles para Power BI:");
  for (const pc of puntosControl) {
    console.log(`  - ${toViewName(pc.nombre)} → ${pc.nombre}`);
  }
  console.log("  - vw_calidad_formato_largo → análisis cruzados entre puntos de control");
  console.log("  - vw_calidad_ultima_muestra → estado actual por lote");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
