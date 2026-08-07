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
// Ruta relativa, no el alias "@/": este archivo corre con tsx desde prisma/.
// Estos dos schemas viven fuera del seed para que el test pueda validarlos contra
// el payload literal de cada formulario (ver src/lib/calidad/schemas/schemas.test.ts).
import { schemaRoturaEncajado } from "../src/lib/calidad/schemas/rotura-encajado.schema";
import { schemaPesoAlfajorOpp } from "../src/lib/calidad/schemas/peso-opp.schema";
import {
  schemaPesoAlfajor,
  schemaPesoRelleno,
  schemaPesoBano,
  schemaPesoTapas,
  schemaTemperaturaTunelCondensacion,
  schemaTemperaturaTanques,
  schemaProduccionDiaria,
  schemaDefectosConformado,
} from "../src/lib/calidad/schemas/puntos-control.schema";
import { BINDINGS } from "../src/lib/calidad/schemas/bindings";

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

  // C1 (AUDITORIA_FLUJOS_DATOS.md, veto de seguridad-analista): el seed NUNCA
  // inventa contraseñas — las 6 cuentas (2 admin) se crean con la misma
  // passphrase, provista por variable de entorno. Fail-fast si falta, mismo
  // criterio que src/lib/prisma.ts con DATABASE_URL: mejor que el seed no
  // corra, a que corra con una contraseña previsible/literal del repo.
  const seedPassword = process.env.SEED_USER_PASSWORD;
  if (!seedPassword) {
    throw new Error(
      "SEED_USER_PASSWORD no está definida — el seed no inventa contraseñas. " +
        "Definila en .env.local (ver .env.example) antes de correr `npm run db:seed`."
    );
  }
  const passwordHash = await bcrypt.hash(seedPassword, 12);

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
      create: { email: "iovando@lacumbre.com.ar", nombre: "Ignacio Ovando", password: passwordHash, rol: Rol.admin },
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
    pcRoturaEncajado,
    pcPesoOpp,
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
    prisma.puntoControl.upsert({
      where: { nombre: "Control de Rotura en Encajado" },
      update: { schemaJson: schemaRoturaEncajado, tipoFormulario: TipoFormulario.rotura_encajado },
      create: {
        nombre: "Control de Rotura en Encajado",
        descripcion:
          "Rotura por máquina encajadora y hora: 1 caja por máquina, 5 categorías de defecto sobre las unidades inspeccionadas.",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.rotura_encajado,
        schemaJson: schemaRoturaEncajado,
      },
    }),
    prisma.puntoControl.upsert({
      where: { nombre: "Control Peso Alfajor + OPP" },
      update: { schemaJson: schemaPesoAlfajorOpp, tipoFormulario: TipoFormulario.peso_paquete_opp },
      create: {
        nombre: "Control Peso Alfajor + OPP",
        descripcion:
          "Peso bruto del alfajor envuelto en film OPP (control de proceso) + verificación de fechado de los mismos 10 paquetes.",
        modulo: ModuloApp.calidad,
        tipoFormulario: TipoFormulario.peso_paquete_opp,
        schemaJson: schemaPesoAlfajorOpp,
      },
    }),
  ]);
  console.log("✅ Puntos de control creados (14)");

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
    // Estación de encajado/envasado — el punto donde el alfajor pasa a producto
    // terminado. A propósito NO se les asigna familia (ver relacionesFamilias).
    { pc: pcRoturaEncajado,      orden: 10 },
    { pc: pcPesoOpp,             orden: 11 },
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
  //
  // "Control de Rotura en Encajado" y "Control Peso Alfajor + OPP" quedan SIN
  // familia a propósito: un PC sin familia se muestra para cualquier producto
  // activo de la línea (CalidadModuloView). Las familias reales las crea
  // scripts/import-maestro-productos.ts con el nombre que venga del Excel — este
  // seed solo garantiza alfajor_negro y tapas, así que bindear a alfajor_negro
  // ESCONDERÍA el control para cualquier otro alfajor, incluido el SKU copacker
  // de Arcor. Si más adelante hay que excluir tapas: mirar primero qué slugs
  // existen de verdad en la tabla, y recordar que el upsert de abajo solo agrega
  // (hace falta un deleteMany explícito, como el de pcPesoBano↔famTapas).
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
    // Rotura en encajado. Son porcentajes DERIVADOS: no existen como clave en
    // `data` (se calculan sobre los 5 contadores y unidades_muestreadas). El
    // binding existe para que el usuario pueda cargarles la tolerancia de la ET
    // vigente desde /maestro y verla en vivo al capturar.
    { clave: "pct_rotura_grupo1", nombre: "Rotura grupo 1 (golpeado menor)", unidad: "%" },
    { clave: "pct_rotura_grupo2", nombre: "Rotura grupo 2 (golpeado mayor + aplastado)", unidad: "%" },
    { clave: "pct_rotura_total", nombre: "Rotura total (grupo 1 + grupo 2)", unidad: "%" },
    // Peso del paquete envuelto en film OPP. Distinto de peso_alfajor (alfajor
    // desnudo): es peso BRUTO y es control de proceso, no de contenido neto.
    { clave: "peso_paquete_opp", nombre: "Peso paquete con OPP", unidad: "g" },
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
  // misma spec; `escalar` = valor único; `derivado` = el valor no existe como
  // clave de `data`, lo calcula el formulario (peso_baño es promedio de restas
  // apareadas; los pct_rotura_* son contadores sobre unidades_muestreadas).
  // `derivado` NO implica "se evalúa al cierre": los pct_rotura_* se comparan en
  // vivo contra la spec mientras el operario carga.
  // La tabla vive en src/lib/calidad/schemas/bindings.ts, no acá: es la MISMA
  // fuente que valida bindings-coherencia.test.ts. Antes el seed la declaraba y
  // el test la replicaba a mano, y por esa rendija pasó un binding roto de
  // `peso_bano` a producción sin que nada lo señalara.
  const pcPorNombre = new Map<string, { id: string }>([
    ["Control Peso Alfajor", pcPesoAlfajor],
    ["Control Peso Relleno", pcPesoRelleno],
    ["Control Peso Baño Alfajor", pcPesoBano],
    ["Control Peso Tapas", pcPesoTapas],
    ["Control Temperatura Condensación Túnel", pcTempTunel],
    ["Control Temperatura Tanques", pcTempTanques],
    ["Producción Diaria — Línea 3", pcProduccionDiaria],
    ["Defectos de Conformado", pcDefectosConformado],
    ["Control de Rotura en Encajado", pcRoturaEncajado],
    ["Control Peso Alfajor + OPP", pcPesoOpp],
  ]);

  for (const b of BINDINGS) {
    const parametro = paramPorClave.get(b.clave);
    const pc = pcPorNombre.get(b.pc);
    // Falla ruidosa en vez de `continue` silencioso: un nombre de punto de
    // control mal escrito en la tabla de bindings dejaría el binding sin sembrar
    // y la especificación correspondiente no se mostraría nunca en captura —
    // exactamente la clase de falla silenciosa que este refactor viene a cerrar.
    if (!pc) throw new Error(`Binding con punto de control desconocido: "${b.pc}" (clave ${b.clave})`);
    if (!parametro) throw new Error(`Binding con parámetro desconocido: "${b.clave}" (pc ${b.pc})`);
    await prisma.puntoControlParametro.upsert({
      where: { puntoControlId_parametroId: { puntoControlId: pc.id, parametroId: parametro.id } },
      update: { campoData: b.campoData, agregacion: b.agregacion },
      create: { puntoControlId: pc.id, parametroId: parametro.id, campoData: b.campoData, agregacion: b.agregacion },
    });
  }
  console.log(`✅ Bindings parámetro↔campo (${BINDINGS.length})`);

  // Los lotes se dan de alta desde /calidad/lotes/nuevo (o el import real de
  // producción) — no hay lotes de prueba en el seed.

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log("\n🎉 Seed completado\n");
  console.log("📧 Credenciales — las 6 cuentas comparten la contraseña de SEED_USER_PASSWORD (nunca impresa acá):");
  console.log("   iovando@lacumbre.com.ar / admin@lacumbre.com.ar / supervisor.calidad@... / operador.calidad@... / jefe.planta@... / gerencia@...");
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
