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
 *   4. Ejecuta los DROP + CREATE VIEW contra la base de datos, en una transaccion.
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

// -----------------------------------------------------------------------------
// Escapado para el DDL — este script usa $executeRawUnsafe, que además acepta
// múltiples sentencias, así que todo lo que venga de la DB tiene que escaparse.
//
// Hoy los `schema_json` y los nombres de punto de control se cargan únicamente
// desde prisma/seed.ts, así que no hay entrada de usuario acá. Pero este script
// corre con DIRECT_URL, o sea el rol dueño del schema: una inyección por esta vía
// no sería "leer datos de más", sería DDL arbitrario con permisos de owner. El día
// que exista una UI que edite schema_json (o un import de Excel que toque puntos
// de control), esto pasa de latente a explotable — el escapado va ahora.
// -----------------------------------------------------------------------------

// Nombres de propiedad aceptables en un schema_json de este repo. Cualquier cosa
// fuera de esto no es un caso de negocio válido: se corta ruidosamente.
const IDENT_OK = /^[a-z][a-z0-9_]{0,62}$/;

function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

// Un \n en un nombre saca el resto de la línea del comentario `--` y lo vuelve SQL.
function comentarioSeguro(s: string): string {
  return s.replace(/[\r\n]+/g, " ");
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

  // Columnas estructurales fijas (siempre presentes en todas las vistas).
  //
  // La línea de negocio (marca_propia | copacker_arcor | fason_terceros) vive en
  // `marcas`, no en `productos`. Antes acá decía `p.linea` y `p.tipo_cliente`,
  // columnas que nunca existieron en el schema: el DDL de TODAS las vistas
  // fallaba, así que no había ninguna vista generada (hallazgo de
  // arquitecto-industrial, 2026-08-05).
  const columnasFijas = `
    rc.id                                          AS registro_id,
    rc.fecha                                       AS fecha,
    rc.hora                                        AS hora,
    l.numero_lote                                  AS numero_lote,
    p.sku                                          AS producto_sku,
    p.nombre                                       AS producto_nombre,
    f.nombre                                       AS familia,
    m.nombre                                       AS marca,
    m.linea_negocio                                AS linea_negocio,
    lp.nombre                                      AS linea_productiva,
    u.nombre                                       AS responsable,
    rc.nro_muestra                                 AS nro_muestra,
    rc.fila_prod                                   AS fila_prod,
    rc.notas                                       AS notas,
    rc.created_at                                  AS creado_en`;

  // Columnas dinámicas del JSONB — una por campo del schema
  const columnasData = Object.entries(properties)
    .map(([campo, def]) => {
      // Se valida el nombre crudo ANTES de interpolarlo. toColumnName sanea el
      // alias, pero el literal del `data ->>` lleva el nombre tal cual: una
      // propiedad como `x')::text AS a, (SELECT ...) AS b, (rc.data->>'y` cerraba
      // el literal y agregaba SQL arbitrario.
      if (!IDENT_OK.test(campo)) {
        throw new Error(
          `Punto de control "${puntoControl.nombre}": la propiedad ${JSON.stringify(
            campo
          )} de su schema_json no es un identificador válido (se espera ${IDENT_OK}). No se genera la vista.`
        );
      }
      const colName = toColumnName(campo);
      const pgType = jsonTypeToPostgres(def);
      // Extrae el campo del JSONB y lo castea al tipo correcto
      return `    (rc.data ->> ${sqlLiteral(campo)})::${pgType}          AS ${sqlIdent(colName)}`;
    })
    .join(",\n");

  return `
-- Vista analítica para: ${comentarioSeguro(puntoControl.nombre)}
-- Generada automáticamente por scripts/generate-views.ts
-- Leer: docs/architecture.md para entender el patrón de generación.
-- NO MODIFICAR MANUALMENTE — regenerar con: npm run db:views
--
-- DROP + CREATE en vez de CREATE OR REPLACE: Postgres no permite quitar ni
-- reordenar columnas con REPLACE, así que agregar una propiedad en el medio de un
-- schema_json fallaba con "cannot change name of view column" y dejaba la vista
-- vieja en pie mientras Power BI la leía como si estuviera al día.
--
-- Sin CASCADE a propósito: si alguien montó una vista o matview encima de esta,
-- CASCADE la borraría sin un solo mensaje. Que falle y se decida a mano.
DROP VIEW IF EXISTS ${sqlIdent(viewName)};
CREATE VIEW ${sqlIdent(viewName)} AS
SELECT
${columnasFijas},
${columnasData}
FROM registros_calidad rc
JOIN puntos_control    pc ON rc.punto_control_id    = pc.id
JOIN lotes             l  ON rc.lote_id             = l.id
JOIN productos         p  ON l.producto_id          = p.id
JOIN familias          f  ON p.familia_id          = f.id
JOIN marcas            m  ON p.marca_id            = m.id
JOIN lineas_productivas lp ON rc.linea_productiva_id = lp.id
JOIN usuarios          u  ON rc.responsable_id      = u.id
-- deleted_at IS NULL: registros_calidad es soft-delete por HACCP (nunca borrado
-- físico). Sin este filtro, una muestra anulada por error de carga entra al
-- reporte que se le muestra al cliente como si fuera un dato real.
WHERE pc.id = ${sqlLiteral(puntoControl.id)}::uuid AND rc.deleted_at IS NULL;

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
DROP VIEW IF EXISTS vw_calidad_formato_largo;
CREATE VIEW vw_calidad_formato_largo AS
SELECT
    rc.id                                    AS registro_id,
    pc.nombre                                AS punto_control,
    rc.fecha                                 AS fecha,
    rc.hora                                  AS hora,
    l.numero_lote                            AS numero_lote,
    p.sku                                    AS producto_sku,
    p.nombre                                 AS producto_nombre,
    m.linea_negocio                          AS linea_negocio,
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
JOIN marcas             m  ON p.marca_id             = m.id
JOIN lineas_productivas lp ON rc.linea_productiva_id  = lp.id
JOIN usuarios           u  ON rc.responsable_id       = u.id,
-- jsonb_each_text aplana el JSONB en filas (campo, valor)
LATERAL jsonb_each_text(rc.data) AS kv(key, value)
-- Soft-delete HACCP: un registro anulado no debe salir al reporte.
WHERE rc.deleted_at IS NULL;
`.trim();
}

// Vista resumen: última muestra por lote y punto de control
function generateResumenUltimaMuestraDDL(): string {
  return `
-- Vista resumen: último registro por lote + punto de control
-- Útil para dashboards de estado actual en Power BI.
DROP VIEW IF EXISTS vw_calidad_ultima_muestra;
CREATE VIEW vw_calidad_ultima_muestra AS
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
-- Soft-delete HACCP. Acá es doblemente importante: sin el filtro, el DISTINCT ON
-- puede elegir justo el registro anulado como "última muestra" del lote.
WHERE rc.deleted_at IS NULL
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

  // toViewName no es inyectivo: "Control Peso Alfajor + OPP" y "Control Peso
  // Alfajor OPP" colapsan al mismo nombre. Sin este chequeo, el segundo punto de
  // control dropea y reemplaza la vista del primero sin ningún error, y Power BI
  // sigue leyendo el mismo nombre mostrando los datos del PC equivocado.
  const porNombreDeVista = new Map<string, string>();
  for (const pc of puntosControl) {
    const viewName = toViewName(pc.nombre);
    const previo = porNombreDeVista.get(viewName);
    if (previo) {
      throw new Error(
        `Colisión de nombre de vista "${viewName}": los puntos de control "${previo}" y "${pc.nombre}" generan el mismo nombre. Renombrá uno de los dos.`
      );
    }
    porNombreDeVista.set(viewName, pc.nombre);
  }

  // Las fallas se cuentan y hacen fallar el proceso al final (ver el throw). No
  // alcanza con logearlas: durante meses TODAS las vistas fallaban (referenciaban
  // p.linea / p.tipo_cliente, columnas inexistentes), el script decía "generación
  // completada" y salía con código 0, así que nadie se enteró de que Power BI no
  // tenía ninguna vista. Un conjunto parcial de vistas no es confiable para
  // reportar: mejor romper ruidosamente.
  let fallas = 0;

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
      fallas++;
      console.error(`   ❌ Error al crear ${viewName}:`, err);
    }
  }

  // Vista formato largo
  console.log("📊 Generando vista: vw_calidad_formato_largo (análisis cruzados)");
  try {
    await prisma.$executeRawUnsafe(generateLongFormatDDL());
    console.log("   ✅ vw_calidad_formato_largo creada/actualizada\n");
  } catch (err) {
    fallas++;
    console.error("   ❌ Error:", err);
  }

  // Vista resumen última muestra
  console.log("📊 Generando vista: vw_calidad_ultima_muestra (estado actual)");
  try {
    await prisma.$executeRawUnsafe(generateResumenUltimaMuestraDDL());
    console.log("   ✅ vw_calidad_ultima_muestra creada/actualizada\n");
  } catch (err) {
    fallas++;
    console.error("   ❌ Error:", err);
  }

  if (fallas > 0) {
    throw new Error(
      `${fallas} vista(s) fallaron. Un conjunto parcial de vistas no es confiable para Power BI: revisá los errores de arriba y volvé a correr.`
    );
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
