import {
  PrismaClient,
  Rol,
  LineaNegocio,
  ModuloApp,
  TipoFormulario,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as dotenvConfig } from "dotenv";
import bcrypt from "bcryptjs";

// Next.js carga .env.local automáticamente; fuera de Next hay que hacerlo a mano
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

// Prisma 7 requiere driver adapter explícito (mismo patrón que src/lib/prisma.ts)
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL no está definida en el entorno");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// =============================================================================
// JSON Schemas — definen qué campos tiene cada formulario de calidad
// El campo `data` de RegistroCalidad se valida contra estos schemas via AJV
// =============================================================================

const schemaPesoAlfajor = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Peso de Alfajor",
  description: "12 mediciones de peso de alfajor sin baño o con baño",
  type: "object",
  required: ["tipo", "mediciones"],
  additionalProperties: false,
  properties: {
    tipo: {
      type: "string",
      enum: ["sin_bano", "con_bano"],
      description: "Tipo de alfajor medido",
    },
    mediciones: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: {
        type: "number",
        minimum: 30,
        maximum: 150,
        multipleOf: 0.1,
      },
      description: "12 mediciones de peso en gramos",
    },
    peso_tapa: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
      description: "Peso de la tapa en gramos (opcional)",
    },
  },
};

const schemaPesoRelleno = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Peso de Relleno",
  description: "12 mediciones de peso de relleno. Aplica a DDL, Bon o Bon u otro.",
  type: "object",
  required: ["tipo_relleno", "mediciones"],
  additionalProperties: false,
  properties: {
    tipo_relleno: {
      type: "string",
      enum: ["dulce_de_leche", "bonobon", "ddl_bob", "otros"],
      description: "Tipo de relleno controlado",
    },
    tipo_relleno_otro: {
      type: "string",
      maxLength: 100,
      description: "Aclaración cuando tipo_relleno = otros",
    },
    mediciones: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: {
        type: "number",
        minimum: 0,
        maximum: 150,
        multipleOf: 0.1,
      },
      description: "12 mediciones de peso de relleno en gramos",
    },
    peso_tapa: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
    },
    presencia_bob: {
      type: "boolean",
      description: "Presencia de BOB (Bon o Bon) — C/NC",
    },
    penetrometria: {
      type: "number",
      minimum: 0,
      maximum: 500,
      description: "Valor penetrométrico (opcional)",
    },
  },
};

const schemaPesoBano = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Peso de Baño",
  description: "12 mediciones P1-P12. Registra T° ambiente y T° baño. Escurrimiento opcional (no se mide en cada muestra en la práctica de planta).",
  type: "object",
  required: ["tipo_producto", "mediciones", "temp_ambiente", "temp_bano"],
  additionalProperties: false,
  properties: {
    tipo_producto: {
      type: "string",
      // "Solo baño" no se mide: el peso del baño es la resta c/baño - s/baño (muestras apareadas)
      enum: ["sandwich_sin_bano", "sandwich_con_bano"],
      description: "Tipo de producto bañado",
    },
    mediciones: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: {
        type: "number",
        minimum: 0,
        maximum: 200,
        multipleOf: 0.1,
      },
      description: "12 mediciones de peso P1-P12 en gramos",
    },
    peso_tapa: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
    },
    temp_ambiente: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
      description: "Temperatura ambiente en °C",
    },
    temp_bano: {
      type: "number",
      minimum: 20,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura del baño de repostería en °C",
    },
    escurrimiento: {
      type: "number",
      minimum: 0,
      maximum: 100,
      multipleOf: 0.1,
      description: "Escurrimiento en gramos",
    },
  },
};

// Control Peso Tapas — PC propio y distinto de "Control Peso Baño Alfajor"
// (ver ADR-015, corrección 2026-07-21: el schema anterior compartido no
// aceptaba este payload y el guardado fallaba siempre — 0 registros
// guardados jamás). Cada observación (pico dosificador 1-12) pesa la MISMA
// tapa dos veces: sin bañar y con baño. La cobertura de chocolate se calcula
// en el cliente por resta apareada (con_baño[i] - sin_bañar[i]) y se envía
// ya calculada — NO hay una tercera medición manual de "baño suelto"
// (confirmado con el usuario: esa fila del diseño anterior no correspondía).
const schemaPesoTapas = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Peso de Tapas",
  description: "12 observaciones (1 por pico dosificador). Cada una pesa la tapa sin bañar y con baño; la cobertura surge de la resta. T° ambiente y T° baño obligatorios, escurrimiento opcional.",
  type: "object",
  required: ["mediciones_tapa", "mediciones_tapa_con_bano", "mediciones_cobertura", "temp_ambiente", "temp_bano"],
  additionalProperties: false,
  properties: {
    mediciones_tapa: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: { type: "number", minimum: 0, maximum: 50, multipleOf: 0.1 },
      description: "12 pesos de tapa SIN bañar en gramos, uno por pico dosificador",
    },
    mediciones_tapa_con_bano: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: { type: "number", minimum: 0, maximum: 60, multipleOf: 0.1 },
      description: "12 pesos de tapa CON baño en gramos, mismo pico y orden que mediciones_tapa",
    },
    mediciones_cobertura: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      // Rango amplio (incluye negativos): esto es una cota de plausibilidad
      // física, no el rango de calidad — el objetivo de calidad vive en
      // EspecificacionProducto (ADR-014/015), no acá (ver ADR-001).
      items: { type: "number", minimum: -10, maximum: 30, multipleOf: 0.01 },
      description: "12 diferencias (con_baño - sin_bañar) en gramos, calculadas en el cliente",
    },
    temp_ambiente: {
      type: "number",
      minimum: 0,
      maximum: 50,
      multipleOf: 0.1,
      description: "Temperatura ambiente en °C",
    },
    temp_bano: {
      type: "number",
      minimum: 20,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura del baño de repostería en °C",
    },
    escurrimiento: {
      type: "number",
      minimum: 0,
      maximum: 100,
      multipleOf: 0.1,
      description: "Escurrimiento en gramos (opcional)",
    },
  },
};

const schemaTemperaturaTunelCondensacion = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Temperatura de Condensación — Salida Túnel",
  description: "Control de temperatura y humedad a la salida del túnel de enfriado. Frecuencia: cada hora.",
  type: "object",
  required: [
    "humedad_relativa",
    "temp_ambiente",
    "temp_producto",
    "temp_rocio",
    "temp_condensacion",
    "temp_interna",
    "peso",
    "espesor",
  ],
  additionalProperties: false,
  properties: {
    humedad_relativa: {
      type: "number",
      minimum: 0,
      maximum: 100,
      multipleOf: 0.1,
      description: "Humedad relativa del ambiente en %",
    },
    temp_ambiente: {
      type: "number",
      minimum: -10,
      maximum: 50,
      multipleOf: 0.1,
      description: "Temperatura ambiente en °C",
    },
    temp_producto: {
      type: "number",
      minimum: -30,
      maximum: 40,
      multipleOf: 0.1,
      description: "Temperatura del producto a la salida del túnel en °C",
    },
    temp_rocio: {
      type: "number",
      minimum: -30,
      maximum: 40,
      multipleOf: 0.1,
      description: "Punto de rocío Td en °C",
    },
    temp_condensacion: {
      type: "number",
      minimum: -30,
      maximum: 40,
      multipleOf: 0.1,
      description: "Temperatura de condensación en °C",
    },
    temp_interna: {
      type: "number",
      minimum: -30,
      maximum: 40,
      multipleOf: 0.1,
      description: "Temperatura interna del producto en °C",
    },
    peso: {
      type: "number",
      minimum: 0,
      maximum: 300,
      multipleOf: 0.1,
      description: "Peso del producto en gramos",
    },
    espesor: {
      type: "number",
      minimum: 0,
      maximum: 100,
      multipleOf: 0.1,
      description: "Espesor del producto en mm",
    },
    tiempo_tunel_min: {
      type: "number",
      minimum: 0,
      maximum: 240,
      description: "Tiempo de túnel en minutos — se registra una vez por jornada",
    },
    observaciones: {
      type: "string",
      maxLength: 500,
    },
  },
};

const schemaTemperaturaTanques = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Temperatura de Tanques",
  description: "Temperatura de los tanques de relleno y cobertura. Controles 3x por día.",
  type: "object",
  required: ["temp_ddl"],
  additionalProperties: false,
  properties: {
    temp_ddl: {
      type: "number",
      minimum: 10,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura Tanque DDL en °C",
    },
    temp_bon_o_bon: {
      type: "number",
      minimum: 10,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura Tanque Bon o Bon en °C",
    },
    tanque_1_cobertura: {
      type: "number",
      minimum: 20,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura Tanque 1 Cobertura en °C",
    },
    tanque_2_cobertura: {
      type: "number",
      minimum: 20,
      maximum: 60,
      multipleOf: 0.1,
      description: "Temperatura Tanque 2 Cobertura en °C",
    },
    observaciones: {
      type: "string",
      maxLength: 500,
    },
  },
};

// PCC1 — Punto Crítico de Control. Verificación obligatoria cada hora.
const schemaDetectorMetales = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Detector de Metales — Alfajor Tapas (PCC1)",
  description: "Verificación horaria del funcionamiento del detector de metales. PCC1.",
  type: "object",
  required: [
    "patron_fe",
    "patron_no_fe",
    "patron_acero_inox",
    "n_rechazos",
    "gabinete_vacio_post",
  ],
  additionalProperties: false,
  properties: {
    patron_fe: {
      type: "string",
      enum: ["conforme", "no_conforme"],
      description: "Patrón Ferroso (Fe)",
    },
    patron_no_fe: {
      type: "string",
      enum: ["conforme", "no_conforme"],
      description: "Patrón No Ferroso (No Fe)",
    },
    patron_acero_inox: {
      type: "string",
      enum: ["conforme", "no_conforme"],
      description: "Patrón Acero Inoxidable (SS)",
    },
    sensibilidad: {
      type: "string",
      maxLength: 50,
      description: "Sensibilidad configurada en el equipo (opcional)",
    },
    programa: {
      type: "string",
      maxLength: 50,
      description: "Programa activo en el detector (ej: PCC1)",
    },
    n_rechazos: {
      type: "integer",
      minimum: 0,
      maximum: 9999,
      description: "Número de rechazos registrados en el período",
    },
    gabinete_vacio_post: {
      type: "boolean",
      description: "Gabinete vacío luego de la verificación",
    },
    acciones: {
      type: "string",
      maxLength: 1000,
      description: "Acciones tomadas en caso de desvío (obligatorio si hay NC)",
    },
  },
};

const schemaFechadoEnvase = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Fechado de Envase Primario y Secundario",
  description: "Verificación de fechado y etiquetado al inicio y en cada cambio de producto.",
  type: "object",
  required: [
    "lote_verificado",
    "vencimiento",
    "vida_util_dias",
    "legible_sin_borrar",
    "fechado_paquete",
    "fechado_caja",
    "rotulo_pallet",
    "ausencia_material_anterior",
  ],
  additionalProperties: false,
  properties: {
    lote_verificado: {
      type: "string",
      maxLength: 100,
      description: "Número de lote impreso en el envase",
    },
    vencimiento: {
      type: "string",
      pattern: "^\\d{2}/\\d{2}/\\d{2}$",
      description: "Fecha de vencimiento impresa en formato DD/MM/AA",
    },
    vida_util_dias: {
      type: "integer",
      minimum: 0,
      maximum: 730,
      description: "Vida útil en días",
    },
    legible_sin_borrar: {
      type: "boolean",
      description: "La impresión es legible y sin borraduras",
    },
    fechado_paquete: {
      type: "string",
      enum: ["conforme", "no_conforme"],
    },
    fechado_caja: {
      type: "string",
      enum: ["conforme", "no_conforme"],
    },
    etiqueta_correcta_paquete: {
      type: "string",
      enum: ["conforme", "no_conforme", "na"],
      description: "C / NC / NA",
    },
    etiqueta_correcta_caja: {
      type: "string",
      enum: ["conforme", "no_conforme", "na"],
    },
    rotulo_pallet: {
      type: "string",
      enum: ["conforme", "no_conforme"],
    },
    ausencia_material_anterior: {
      type: "boolean",
      description: "Sin material del producto anterior en la línea",
    },
    acciones: {
      type: "string",
      maxLength: 1000,
      description: "Acciones correctivas tomadas",
    },
  },
};

const schemaProduccionDiaria = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Control de Producción Diaria",
  description: "Registro continuo de producción: cajas, pallets, lote producto terminado y peso.",
  type: "object",
  required: ["cajas", "lote_pt", "vencimiento_pt"],
  additionalProperties: false,
  properties: {
    cajas: {
      type: "integer",
      minimum: 0,
      maximum: 99999,
      description: "Cantidad de cajas producidas",
    },
    pallet_numero: {
      type: "integer",
      minimum: 1,
      description: "Número de pallet — correlativo automático por día",
    },
    pallet_incompleto: {
      type: "boolean",
      description: "El pallet quedó incompleto (se registran las cajas cargadas)",
    },
    tiempo_tunel_min: {
      type: "number",
      minimum: 0,
      maximum: 240,
      description: "Tiempo de túnel en minutos — se registra una vez por turno",
    },
    lote_pt: {
      type: "string",
      maxLength: 100,
      description: "Lote de producto terminado",
    },
    vencimiento_pt: {
      type: "string",
      pattern: "^\\d{2}/\\d{2}/\\d{2}$",
      description: "Fecha de vencimiento del lote PT en formato DD/MM/AA",
    },
    peso_alfajor: {
      type: "number",
      minimum: 30,
      maximum: 150,
      multipleOf: 0.1,
      description: "Peso de alfajor chequeado en ese momento (opcional)",
    },
    zona_tunel_1: {
      type: "number",
      description: "Temperatura zona 1 del túnel (opcional)",
    },
    zona_tunel_2: {
      type: "number",
      description: "Temperatura zona 2 del túnel (opcional)",
    },
    zona_tunel_3: {
      type: "number",
      description: "Temperatura zona 3 del túnel (opcional)",
    },
    observaciones: {
      type: "string",
      maxLength: 500,
    },
  },
};

// Trazabilidad de insumos — un registro por CAMBIO de lote de insumo (no por turno).
// Cruza con el correlativo de pallets de Producción Diaria para acotar recalls.
const schemaTrazabilidadInsumos = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Trazabilidad de Insumos",
  description: "Registro de entrada en uso de un lote de insumo. Un registro por cambio de lote.",
  type: "object",
  required: ["insumo", "lote_insumo"],
  additionalProperties: false,
  properties: {
    insumo: {
      type: "string",
      // tapas_sin_banar: tapa cruda que entra al proceso de baño de TAPAS —
      // distinto de tapas_banadas (la tapa YA bañada, que es la SALIDA de ese
      // proceso y el insumo de ENTRADA para armar alfajores). No corresponde
      // trazar tapas_banadas al producir TAPAS: sería trazar como insumo la
      // salida del propio proceso (confirmado con el usuario, ver LOG_CONTEXTO).
      enum: ["tapas_sin_banar", "tapas_banadas", "bonobon", "dulce_de_leche", "bano_chocolate"],
      description: "Tipo de insumo que entra en uso",
    },
    lote_insumo: {
      type: "string",
      maxLength: 100,
      description: "Número de lote del insumo",
    },
    observaciones: {
      type: "string",
      maxLength: 500,
    },
  },
};

const schemaDefectosConformado = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Defectos de Conformado",
  description: "Control de defectos visuales y gravimétricos en conformado de alfajores",
  type: "object",
  required: ["fistula", "barril", "ventana", "mal_baniado", "peso_neto"],
  additionalProperties: false,
  properties: {
    fistula: {
      type: "string",
      enum: ["Sin fístula", "Fístula <1cm", "Fístula >1cm"],
    },
    barril: {
      type: "string",
      enum: ["Sin barril", "Barril aprobado", "Barril rechazado"],
    },
    ventana: {
      type: "string",
      enum: ["Sin ventana", "Ventana ≤1cm", "Ventana 1-3cm", "Ventana >5cm"],
    },
    mal_baniado: {
      type: "boolean",
    },
    peso_neto: {
      type: "number",
      minimum: 60,
      maximum: 100,
      multipleOf: 0.1,
    },
  },
};

const schemaInspeccionMasa = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Inspección Visual Masa",
  type: "object",
  required: ["color", "consistencia", "temperatura_c", "aprobado"],
  additionalProperties: false,
  properties: {
    color: { type: "string", enum: ["Aceptable", "Oscura", "Clara", "Irregular"] },
    consistencia: { type: "string", enum: ["Óptima", "Blanda", "Dura", "Irregular"] },
    temperatura_c: { type: "number", minimum: 18, maximum: 35, multipleOf: 0.1 },
    aprobado: { type: "boolean" },
  },
};

// =============================================================================
// SEED
// =============================================================================

async function main() {
  console.log("🌱 Iniciando seed — La Cumbre Control de Producción...\n");

  const passwordHash = await bcrypt.hash("password123", 12);

  // ── Turnos ─────────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.turno.upsert({
      where: { nombre: "Mañana" },
      update: { horaInicio: "06:00", horaFin: "14:00" },
      create: { nombre: "Mañana", horaInicio: "06:00", horaFin: "14:00" },
    }),
    prisma.turno.upsert({
      where: { nombre: "Tarde" },
      update: { horaInicio: "14:00", horaFin: "22:00" },
      create: { nombre: "Tarde", horaInicio: "14:00", horaFin: "22:00" },
    }),
    prisma.turno.upsert({
      where: { nombre: "Noche" },
      update: { horaInicio: "22:00", horaFin: "06:00" },
      create: { nombre: "Noche", horaInicio: "22:00", horaFin: "06:00" },
    }),
  ]);
  console.log("✅ Turnos: Mañana / Tarde / Noche");

  // ── Usuarios ───────────────────────────────────────────────────────────────
  const [admin] = await Promise.all([
    prisma.usuario.upsert({
      where: { email: "iovando@lacumbre.com.ar" },
      update: {},
      create: { email: "iovando@lacumbre.com.ar", nombre: "Ignacio Ovando", password: await bcrypt.hash("lacumbre", 12), rol: Rol.admin },
    }),
    prisma.usuario.upsert({
      where: { email: "admin@lacumbre.com.ar" },
      update: {},
      create: { email: "admin@lacumbre.com.ar", nombre: "Admin La Cumbre", password: passwordHash, rol: Rol.admin },
    }),
    prisma.usuario.upsert({
      where: { email: "supervisor.calidad@lacumbre.com.ar" },
      update: {},
      create: { email: "supervisor.calidad@lacumbre.com.ar", nombre: "María García", password: passwordHash, rol: Rol.supervisor_calidad },
    }),
    prisma.usuario.upsert({
      where: { email: "operador.calidad@lacumbre.com.ar" },
      update: {},
      create: { email: "operador.calidad@lacumbre.com.ar", nombre: "Juan Pérez", password: passwordHash, rol: Rol.operador_calidad },
    }),
    prisma.usuario.upsert({
      where: { email: "jefe.planta@lacumbre.com.ar" },
      update: {},
      create: { email: "jefe.planta@lacumbre.com.ar", nombre: "Carlos Rodríguez", password: passwordHash, rol: Rol.jefe_planta },
    }),
    prisma.usuario.upsert({
      where: { email: "gerencia@lacumbre.com.ar" },
      update: {},
      create: { email: "gerencia@lacumbre.com.ar", nombre: "Ana Martínez", password: passwordHash, rol: Rol.gerencia },
    }),
  ]);
  console.log("✅ Usuarios creados (6)");

  // ── Marcas y familias base ─────────────────────────────────────────────────
  // El catálogo completo lo carga scripts/import-maestro-productos.ts desde el Excel.
  // Acá solo lo mínimo para que los lotes de prueba tengan productos válidos.
  const [marcaArcor, marcaGoat, marcaLC] = await Promise.all([
    prisma.marca.upsert({
      where: { nombre: "ARCOR" },
      update: {},
      create: { nombre: "ARCOR", lineaNegocio: LineaNegocio.copacker_arcor },
    }),
    prisma.marca.upsert({
      where: { nombre: "GOAT" },
      update: {},
      create: { nombre: "GOAT", lineaNegocio: LineaNegocio.copacker_arcor },
    }),
    prisma.marca.upsert({
      where: { nombre: "LC" },
      update: {},
      create: { nombre: "LC", lineaNegocio: LineaNegocio.marca_propia },
    }),
  ]);

  const [famAlfajorNegro, famTapas] = await Promise.all([
    prisma.familia.upsert({
      where: { nombre: "ALFAJOR NEGRO" },
      update: {},
      create: { nombre: "ALFAJOR NEGRO", slug: "alfajor_negro" },
    }),
    prisma.familia.upsert({
      where: { nombre: "TAPAS" },
      update: {},
      create: { nombre: "TAPAS", slug: "tapas" },
    }),
  ]);

  // Los productos y lotes reales se cargan vía `npm run db:import-productos`
  // (Excel) y la pantalla de Alta de Lote — este seed solo deja creadas las
  // marcas/familias que necesitan las relaciones puntos_control_familias.
  console.log("✅ Marcas (3) y familias (2) creadas");

  // ── Líneas productivas ─────────────────────────────────────────────────────
  // "Línea de Masa" y "Línea de Envasado" eran scaffolding de demo — el usuario
  // las eliminó de la DB real una vez conectado Supabase. Hoy solo Línea 3 tiene
  // puntos de control reales; las líneas 0/1/2 del maestro las crea el import.
  const [linea3] = await Promise.all([
    prisma.lineaProductiva.upsert({
      where: { nombre: "Línea 3" },
      update: { codigo: 3 },
      create: { nombre: "Línea 3", codigo: 3, descripcion: "Conformado, bañado y empaque de alfajores", modulo: ModuloApp.calidad },
    }),
  ]);
  console.log("✅ Línea productiva: Línea 3");

  // ── Puntos de control — Línea 3 ───────────────────────────────────────────
  const [
    pcPesoAlfajor,
    pcPesoRelleno,
    pcPesoBano,
    pcPesoTapas,
    pcTempTunel,
    pcTempTanques,
    pcDetectorMetales,
    pcFechadoEnvase,
    pcProduccionDiaria,
    pcDefectosConformado,
    pcInspeccionMasa,
    pcTrazabilidadInsumos,
  ] = await Promise.all([
    prisma.puntoControl.upsert({
      where: { nombre: "Control Peso Alfajor" },
      update: { schemaJson: schemaPesoAlfajor, tipoFormulario: TipoFormulario.peso_alfajor },
      create: {
        nombre: "Control Peso Alfajor",
        descripcion: "12 mediciones de peso de alfajor sin baño y con baño",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.peso_alfajor,
        schemaJson: schemaPesoAlfajor,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Control Peso Relleno" },
      update: { schemaJson: schemaPesoRelleno, tipoFormulario: TipoFormulario.peso_relleno },
      create: {
        nombre: "Control Peso Relleno",
        descripcion: "12 mediciones de peso de relleno (DDL, Bon o Bon, otro)",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.peso_relleno,
        schemaJson: schemaPesoRelleno,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Control Peso Baño Alfajor" },
      update: { schemaJson: schemaPesoBano, tipoFormulario: TipoFormulario.peso_bano },
      create: {
        nombre: "Control Peso Baño Alfajor",
        descripcion: "12 mediciones P1-P12 con temperatura de baño y escurrimiento",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.peso_bano,
        schemaJson: schemaPesoBano,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Control Peso Tapas" },
      update: { schemaJson: schemaPesoTapas, tipoFormulario: TipoFormulario.peso_bano },
      create: {
        nombre: "Control Peso Tapas",
        descripcion: "12 observaciones (1 por pico dosificador): peso de tapa sin bañar y con baño; la cobertura surge de la resta",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.peso_bano,
        schemaJson: schemaPesoTapas,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Control Temperatura Condensación Túnel" },
      update: { schemaJson: schemaTemperaturaTunelCondensacion, tipoFormulario: TipoFormulario.temperatura_condensacion },
      create: {
        nombre: "Control Temperatura Condensación Túnel",
        descripcion: "Temperatura y humedad a la salida del túnel de enfriado. Cada 30 min.",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.temperatura_condensacion,
        schemaJson: schemaTemperaturaTunelCondensacion,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Control Temperatura Tanques" },
      update: { schemaJson: schemaTemperaturaTanques, tipoFormulario: TipoFormulario.temperatura_tanques },
      create: {
        nombre: "Control Temperatura Tanques",
        descripcion: "Temperatura de tanques de relleno y cobertura. 3 controles por día.",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.temperatura_tanques,
        schemaJson: schemaTemperaturaTanques,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Detector de Metales — Alfajor (PCC1)" },
      update: { schemaJson: schemaDetectorMetales, tipoFormulario: TipoFormulario.detector_metales },
      create: {
        nombre: "Detector de Metales — Alfajor (PCC1)",
        descripcion: "Verificación horaria del detector de metales. Punto Crítico de Control PCC1.",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.detector_metales,
        schemaJson: schemaDetectorMetales,
      },
    }),
    // Control de fechado: queda en planilla física (papel), no se digitaliza.
    prisma.puntoControl.upsert({
      where: { nombre: "Control Fechado de Envase" },
      update: { schemaJson: schemaFechadoEnvase, tipoFormulario: TipoFormulario.fechado_envase, activo: false },
      create: {
        nombre: "Control Fechado de Envase",
        descripcion: "Verificación de fechado y etiquetado al inicio y en cada cambio de producto.",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.fechado_envase,
        schemaJson: schemaFechadoEnvase,
        activo: false,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Producción Diaria — Línea 3" },
      update: { schemaJson: schemaProduccionDiaria, tipoFormulario: TipoFormulario.produccion_diaria },
      create: {
        nombre: "Producción Diaria — Línea 3",
        descripcion: "Registro continuo de cajas, pallets, lote PT y vencimiento.",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.produccion_diaria,
        schemaJson: schemaProduccionDiaria,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Defectos de Conformado" },
      update: { schemaJson: schemaDefectosConformado, tipoFormulario: TipoFormulario.defectos_conformado },
      create: {
        nombre: "Defectos de Conformado",
        descripcion: "Control de defectos visuales y gravimétricos en conformado",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.defectos_conformado,
        schemaJson: schemaDefectosConformado,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Inspección Visual Masa" },
      update: { schemaJson: schemaInspeccionMasa, tipoFormulario: TipoFormulario.inspeccion_visual },
      create: {
        nombre: "Inspección Visual Masa",
        descripcion: "Control visual y de temperatura de masa antes del conformado",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.inspeccion_visual,
        schemaJson: schemaInspeccionMasa,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Trazabilidad Insumos" },
      update: { schemaJson: schemaTrazabilidadInsumos, tipoFormulario: TipoFormulario.trazabilidad_insumos },
      create: {
        nombre: "Trazabilidad Insumos",
        descripcion: "Registro de lote de insumo en uso: tapas bañadas, Bonobon, DDL, baño de chocolate.",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.trazabilidad_insumos,
        schemaJson: schemaTrazabilidadInsumos,
      },
    }),
  ]);
  console.log("✅ Puntos de control creados (12)");

  // ── Relaciones línea ↔ punto de control ────────────────────────────────────
  // Línea 3 — Conformado Alfajores (orden refleja flujo productivo)
  // Fechado de envase excluido: el control queda en planilla física.
  const relacionesLinea3 = [
    { pc: pcPesoAlfajor,         orden: 1 },
    { pc: pcPesoRelleno,         orden: 2 },
    { pc: pcPesoBano,            orden: 3 },
    // Mismo orden que pcPesoBano a propósito: son mutuamente excluyentes por
    // familia (alfajor_negro vs tapas), nunca se renderizan juntos en la grilla.
    { pc: pcPesoTapas,           orden: 3 },
    { pc: pcTempTunel,           orden: 4 },
    { pc: pcTempTanques,         orden: 5 },
    { pc: pcDetectorMetales,     orden: 6 },
    { pc: pcProduccionDiaria,    orden: 7 },
    { pc: pcDefectosConformado,  orden: 8 },
    { pc: pcTrazabilidadInsumos, orden: 9 },
  ];

  // Eliminar la relación de fechado si quedó de un seed anterior
  await prisma.puntoControlLinea.deleteMany({
    where: { puntoControlId: pcFechadoEnvase.id, lineaProductivaId: linea3.id },
  });

  // Eliminar la relación vieja pcPesoBano↔famTapas (2026-07-21, hallazgo de
  // seguridad-analista): el upsert de abajo solo AGREGA relaciones, nunca borra
  // las que dejaron de corresponder. Antes de este fix, "Control Peso Baño
  // Alfajor" estaba asociado a AMBAS familias; ahora que TAPAS tiene su propio
  // PC ("Control Peso Tapas"), esta fila vieja debe irse explícitamente — si no,
  // reaparece la ambigüedad (2 PCs de peso mostrados a la vez para tapas) que
  // originó el bug de guardado nunca exitoso que este cambio corrige.
  await prisma.puntoControlFamilia.deleteMany({
    where: { puntoControlId: pcPesoBano.id, familiaId: famTapas.id },
  });

  // ── Familias por punto de control ───────────────────────────────────────────
  // Reemplaza el hardcodeo de familias[] del frontend demo.
  const relacionesFamilias = [
    { pc: pcPesoAlfajor, familia: famAlfajorNegro },
    { pc: pcPesoRelleno, familia: famAlfajorNegro },
    { pc: pcPesoBano, familia: famAlfajorNegro },
    { pc: pcPesoTapas, familia: famTapas },
  ];
  for (const { pc, familia } of relacionesFamilias) {
    await prisma.puntoControlFamilia.upsert({
      where: { puntoControlId_familiaId: { puntoControlId: pc.id, familiaId: familia.id } },
      update: {},
      create: { puntoControlId: pc.id, familiaId: familia.id },
    });
  }
  console.log("✅ Familias asignadas a puntos de control");

  for (const { pc, orden } of relacionesLinea3) {
    await prisma.puntoControlLinea.upsert({
      where: { puntoControlId_lineaProductivaId: { puntoControlId: pc.id, lineaProductivaId: linea3.id } },
      update: { orden },
      create: { puntoControlId: pc.id, lineaProductivaId: linea3.id, orden },
    });
  }

  // "Inspección Visual Masa" queda en el catálogo de puntos de control sin
  // asignar a ninguna línea todavía (la línea que la usaba se eliminó).
  console.log("✅ Relaciones línea ↔ punto de control configuradas");

  // ── Catálogo de parámetros + bindings (ADR-015) ─────────────────────────────
  // Catálogo CERRADO de parámetros especificables. Los bindings (punto de control
  // × parámetro → campo de data + agregación) son ESTRUCTURA derivada de los
  // schema_json de arriba, no dato de negocio — por eso van en el seed. Las
  // especificaciones (rangos por producto) NO se siembran: son dato de calidad,
  // se cargan a demanda desde el módulo admin.
  const parametrosCatalogo = [
    { clave: "peso_alfajor", nombre: "Peso alfajor", unidad: "g" },
    { clave: "peso_relleno", nombre: "Peso relleno", unidad: "g" },
    { clave: "peso_bano", nombre: "Peso baño", unidad: "g" },
    { clave: "peso_tapa", nombre: "Peso tapa", unidad: "g" },
    { clave: "peso_neto", nombre: "Peso neto conformado", unidad: "g" },
    { clave: "temp_producto", nombre: "Temp. producto salida túnel", unidad: "°C" },
    { clave: "temp_condensacion", nombre: "Temp. condensación", unidad: "°C" },
    { clave: "humedad_relativa", nombre: "Humedad relativa", unidad: "%" },
    { clave: "temp_ddl", nombre: "Temp. tanque DDL", unidad: "°C" },
    { clave: "temp_bon_o_bon", nombre: "Temp. tanque Bon o Bon", unidad: "°C" },
    { clave: "temp_cobertura_1", nombre: "Temp. cobertura tanque 1", unidad: "°C" },
    { clave: "temp_cobertura_2", nombre: "Temp. cobertura tanque 2", unidad: "°C" },
    { clave: "temp_bano", nombre: "Temp. baño", unidad: "°C" },
    { clave: "peso_cobertura", nombre: "Peso cobertura (tapa)", unidad: "g" },
    // PCC del plan HACCP (confirmado por el usuario, 2026-07-21): temperatura
    // interna del producto a la salida del túnel — mide el EFECTO del proceso
    // de enfriado sobre el producto (a diferencia de los demás campos de esa
    // planilla, que son condiciones ambientales, la causa). Sigue obligatorio
    // en el schema; este parámetro habilita cargarle una spec con esCritico: true.
    { clave: "temp_interna", nombre: "Temp. interna producto (PCC)", unidad: "°C" },
  ] as const;

  const paramPorClave = new Map<string, { id: string }>();
  for (const p of parametrosCatalogo) {
    const parametro = await prisma.parametro.upsert({
      where: { clave: p.clave },
      update: { nombre: p.nombre, unidad: p.unidad },
      create: { clave: p.clave, nombre: p.nombre, unidad: p.unidad },
    });
    paramPorClave.set(p.clave, parametro);
  }
  console.log(`✅ Catálogo de parámetros (${parametrosCatalogo.length})`);

  // Binding: en qué campo de `data` vive cada parámetro por punto de control y
  // cómo se agrega. `array_cada` = cada elemento del array se compara contra la
  // misma spec; `escalar` = valor único; `derivado` = no se compara en vivo, se
  // evalúa al cierre (peso_baño es promedio de restas apareadas).
  const bindings: { pc: { id: string }; clave: string; campoData: string; agregacion: "escalar" | "array_cada" | "array_promedio" | "derivado" }[] = [
    { pc: pcPesoAlfajor, clave: "peso_alfajor", campoData: "mediciones", agregacion: "array_cada" },
    { pc: pcPesoAlfajor, clave: "peso_tapa", campoData: "peso_tapa", agregacion: "escalar" },
    { pc: pcPesoRelleno, clave: "peso_relleno", campoData: "mediciones", agregacion: "array_cada" },
    { pc: pcPesoBano, clave: "peso_bano", campoData: "mediciones", agregacion: "derivado" },
    { pc: pcPesoBano, clave: "temp_bano", campoData: "temp_bano", agregacion: "escalar" },
    // Control Peso Tapas: mismos parámetros lógicos peso_tapa/temp_bano que
    // Alfajor, pero bindeados a los campos y agregación propios de este PC
    // (ver ADR-015 — un Parametro puede tener un binding por punto de control).
    { pc: pcPesoTapas, clave: "peso_tapa", campoData: "mediciones_tapa", agregacion: "array_cada" },
    { pc: pcPesoTapas, clave: "peso_cobertura", campoData: "mediciones_cobertura", agregacion: "array_cada" },
    { pc: pcPesoTapas, clave: "temp_bano", campoData: "temp_bano", agregacion: "escalar" },
    { pc: pcTempTunel, clave: "temp_producto", campoData: "temp_producto", agregacion: "escalar" },
    { pc: pcTempTunel, clave: "temp_condensacion", campoData: "temp_condensacion", agregacion: "escalar" },
    { pc: pcTempTunel, clave: "humedad_relativa", campoData: "humedad_relativa", agregacion: "escalar" },
    { pc: pcTempTunel, clave: "temp_interna", campoData: "temp_interna", agregacion: "escalar" },
    { pc: pcTempTanques, clave: "temp_ddl", campoData: "temp_ddl", agregacion: "escalar" },
    { pc: pcTempTanques, clave: "temp_bon_o_bon", campoData: "temp_bon_o_bon", agregacion: "escalar" },
    { pc: pcTempTanques, clave: "temp_cobertura_1", campoData: "tanque_1_cobertura", agregacion: "escalar" },
    { pc: pcTempTanques, clave: "temp_cobertura_2", campoData: "tanque_2_cobertura", agregacion: "escalar" },
    { pc: pcProduccionDiaria, clave: "peso_alfajor", campoData: "peso_alfajor", agregacion: "escalar" },
    { pc: pcDefectosConformado, clave: "peso_neto", campoData: "filas[].peso_neto", agregacion: "array_cada" },
  ];

  for (const b of bindings) {
    const parametro = paramPorClave.get(b.clave);
    if (!parametro) continue;
    await prisma.puntoControlParametro.upsert({
      where: { puntoControlId_parametroId: { puntoControlId: b.pc.id, parametroId: parametro.id } },
      update: { campoData: b.campoData, agregacion: b.agregacion },
      create: { puntoControlId: b.pc.id, parametroId: parametro.id, campoData: b.campoData, agregacion: b.agregacion },
    });
  }
  console.log(`✅ Bindings parámetro↔campo (${bindings.length})`);

  // Los lotes se dan de alta desde /calidad/lotes/nuevo (o el import real de
  // producción) — no hay lotes de prueba en el seed.

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log("\n🎉 Seed completado\n");
  console.log("📧 Credenciales:");
  console.log("   iovando@lacumbre.com.ar       / lacumbre     (admin)");
  console.log("   admin@lacumbre.com.ar          / password123  (admin)");
  console.log("   supervisor.calidad@lacumbre... / password123  (supervisor)");
  console.log("   operador.calidad@lacumbre...   / password123  (operador)");
  console.log("\n🏭 Línea 3 — 10 puntos de control cargados (Peso Baño Alfajor y Peso Tapas son mutuamente excluyentes por familia, se ve 1 de los 2 a la vez)");

  void admin; // evitar unused warning
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
