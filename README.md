# Plataforma Industrial La Cumbre — Control de Producción

Sistema de gestión industrial modular para digitalización, ingesta y análisis de datos de manufactura alimenticia (copacker Arcor + marca propia + fasón).

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend + Backend | Next.js 14 (App Router), TypeScript estricto |
| ORM | Prisma 7 |
| Base de datos | PostgreSQL |
| Validación API | Zod (estructura) + AJV (datos JSONB) |
| Autenticación | NextAuth v5 |
| UI | Tailwind CSS v4 — mobile/tablet-first |

---

## Estructura de carpetas

```
src/
├── app/                        # Next.js App Router (rutas y layouts)
│   ├── page.tsx                # Home — 3 módulos
│   ├── calidad/                # Módulo Calidad
│   │   ├── page.tsx            # Vista de módulo: tabs por línea productiva
│   │   └── [lineaId]/
│   │       └── [puntoControlId]/
│   │           └── page.tsx    # Formulario de carga del punto de control
│   ├── produccion/             # Estructura lista, en desarrollo
│   ├── deposito/               # Estructura lista, en desarrollo
│   └── api/v1/calidad/         # Endpoints REST versionados
├── components/
│   └── calidad/                # Componentes del módulo Calidad
├── db/                         # Repository layer — solo queries Prisma
├── services/calidad/           # Service layer — validación + lógica de dominio
├── lib/                        # Utilitarios compartidos (prisma.ts, validate-jsonb.ts)
└── types/                      # Tipos TypeScript del dominio

prisma/
├── schema.prisma               # Esquema de base de datos
├── prisma.config.ts            # Config Prisma 7 (adaptador pg)
└── seed.ts                     # Datos de prueba

scripts/
└── generate-views.ts           # Generador de vistas analíticas para Power BI
```

---

## Setup inicial

```bash
# 1. Clonar e instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con la URL de tu base de datos PostgreSQL

# 3. Crear la base de datos (en PostgreSQL)
createdb control_produccion

# 4. Correr las migraciones
npm run db:migrate

# 5. Cargar datos de prueba
npm run db:seed

# 6. Generar vistas analíticas para Power BI
npm run db:views

# 7. Levantar el servidor de desarrollo
npm run dev
```

---

## Patrón de extensibilidad: cómo agregar un nuevo punto de control

**Esta es la decisión de diseño más importante del proyecto. Leer antes de agregar funcionalidad.**

### El problema que resuelve

En sistemas industriales, los "puntos de control" (qué se mide, con qué campos, con qué rangos) cambian con frecuencia. El enfoque naïve crea una tabla por punto de control, generando decenas de tablas con estructura casi idéntica, migraciones cada vez que cambia un campo, y código duplicado. Este sistema resuelve eso con un patrón híbrido.

### Arquitectura: escritura flexible + lectura analítica tipada

```
┌─────────────────────────────────────────────────────────────────┐
│ MODELO DE ESCRITURA (ingesta)                                   │
│                                                                 │
│  puntos_control                  registros_calidad              │
│  ┌──────────────────┐            ┌──────────────────────┐       │
│  │ id               │◄───────────│ punto_control_id     │       │
│  │ nombre           │            │ lote_id              │       │
│  │ schema_json ─────┼──┐         │ linea_productiva_id  │       │
│  └──────────────────┘  │ valida  │ fecha / hora         │       │
│                         │ (AJV)  │ nro_muestra          │       │
│                         └───────►│ data (JSONB) ◄───────┼───┐  │
│                                  └──────────────────────┘   │  │
└──────────────────────────────────────────────────────────────┼──┘
                                                               │
┌──────────────────────────────────────────────────────────────┼──┐
│ MODELO DE LECTURA (Power BI)                                  │  │
│                                                               │  │
│  vw_defectos_conformado           vw_calidad_formato_largo    │  │
│  ┌──────────────────────┐         ┌──────────────────────┐   │  │
│  │ fecha                │         │ fecha                │   │  │
│  │ numero_lote          │         │ punto_control        │   │  │
│  │ responsable          │◄────────│ campo                │   │  │
│  │ fistula (TEXT)       │ aplana  │ valor (TEXT)         │   │  │
│  │ barril (TEXT)        │ JSONB   └──────────────────────┘   │  │
│  │ ventana (TEXT)       │                                     │  │
│  │ peso_neto (NUMERIC)  │◄────────────────────────────────────┘  │
│  └──────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────┘
```

### Cómo agregar un nuevo punto de control (ejemplo: "Control Penetrometría")

```sql
-- Paso 1: Insertar el punto de control con su JSON Schema
INSERT INTO puntos_control (id, nombre, descripcion, modulo, schema_json) VALUES (
  gen_random_uuid(),
  'Control Penetrometría',
  'Medición de penetrometría en masa antes de conformado',
  'calidad',
  '{
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["profundidad_mm", "temperatura_c", "aprobado"],
    "properties": {
      "profundidad_mm": { "type": "number", "minimum": 5, "maximum": 30 },
      "temperatura_c": { "type": "number", "minimum": 15, "maximum": 40 },
      "aprobado": { "type": "boolean" }
    }
  }'
);

-- Paso 2: Asociar a las líneas productivas que corresponda
INSERT INTO puntos_control_lineas (punto_control_id, linea_productiva_id, orden)
VALUES ('<id del punto de control>', '<id de la línea>', 3);
```

```bash
# Paso 3: Regenerar la vista analítica automáticamente
npm run db:views
# → Crea vw_control_penetrometria con columnas profundidad_mm, temperatura_c, aprobado
```

**Resultado:** la UI de `/calidad` mostrará automáticamente el nuevo punto de control en la grilla de la línea asociada, ya que los puntos de control se leen dinámicamente de la base de datos.

### Qué NO hay que hacer

- ❌ No crear una tabla `registros_penetrometria` nueva.
- ❌ No agregar columnas a `registros_calidad`.
- ❌ No modificar el código de la API.
- ❌ No hardcodear el nuevo punto en el frontend.

---

## Cómo agregar un nuevo módulo (ej: "Mantenimiento")

1. Agregar el valor `mantenimiento` al enum `ModuloApp` en `schema.prisma` y correr `prisma migrate dev`.
2. Crear las líneas productivas con `modulo: 'mantenimiento'`.
3. Crear los puntos de control con `modulo: 'mantenimiento'`.
4. Crear la ruta `src/app/mantenimiento/` siguiendo el mismo patrón que `src/app/calidad/`.
5. Agregar la tarjeta al home en `src/app/page.tsx`.

---

## API Reference

### Versión actual: `/api/v1`

#### `POST /api/v1/calidad/registros`

Ingesta un registro de calidad. Agnóstico del origen (UI web, sensor IoT, balanza industrial, script).

```json
{
  "puntoControlId": "uuid",
  "loteId": "uuid",
  "lineaProductivaId": "uuid",
  "responsableId": "uuid",
  "fecha": "2024-01-15",
  "hora": "14:30:00",
  "nroMuestra": 1,
  "filaProd": 3,
  "notas": "Observación opcional",
  "data": {
    // Campos específicos del punto de control, validados contra schema_json
    "fistula": "Sin fístula",
    "barril": "Sin barril",
    "ventana": "Sin ventana",
    "mal_baniado": false,
    "peso_neto": 78.5
  }
}
```

Respuestas:
- `201 { data: RegistroCalidad }` — registro creado
- `400 { error, code, details }` — validación fallida (Zod o AJV)
- `500 { error, code }` — error interno (sin stack trace)

#### `GET /api/v1/calidad/registros?lineaProductivaId=<uuid>&limit=50`

Historial de registros por línea productiva.

#### `GET /api/v1/calidad/lineas`

Todas las líneas productivas del módulo Calidad con sus puntos de control.

#### `GET /api/v1/calidad/puntos-control?lineaId=<uuid>`

Puntos de control de una línea específica.

---

## Conexión Power BI

### Prerrequisitos

- PostgreSQL accesible desde la máquina donde corre Power BI (port 5432 abierto o tunel SSH).
- Driver PostgreSQL para Power BI: [Npgsql](https://www.npgsql.org/doc/index.html) o via ODBC.

### Cadena de conexión

```
Server=<host>;Port=5432;Database=control_produccion;User Id=<usuario>;Password=<password>;
```

### Vistas recomendadas

| Vista | Cuándo usarla |
|---|---|
| `vw_defectos_conformado` | Análisis de defectos específicos: fístula, barril, ventana, peso neto |
| `vw_control_peso_de_relleno` | Análisis de peso de relleno |
| `vw_calidad_formato_largo` | Análisis cruzados entre múltiples puntos de control (campo + valor) |
| `vw_calidad_ultima_muestra` | Estado actual: último registro por lote y punto de control |

### Flujo recomendado en Power BI

1. **Fuente de datos** → PostgreSQL → conectar con las credenciales.
2. **Transformaciones mínimas**: las vistas ya incluyen JOINs con lotes, productos, responsables y líneas — no hace falta joins adicionales en Power Query.
3. **Relaciones**: si se usan múltiples vistas, relacionarlas por `registro_id` o `numero_lote`.
4. Las columnas de tipo NUMERIC en las vistas anchas (ej: `peso_neto`) se mapean directamente a medidas numéricas en Power BI.

### Agregar una nueva vista para un punto de control nuevo

```bash
npm run db:views
# Detecta automáticamente los nuevos puntos de control y crea/actualiza sus vistas.
# En Power BI: actualizar el origen de datos para ver la nueva vista.
```

---

## Credenciales de prueba (seed)

| Rol | Email | Password |
|---|---|---|
| Admin | admin@lacumbre.com.ar | password123 |
| Supervisor Calidad | supervisor.calidad@lacumbre.com.ar | password123 |
| Operador Calidad | operador.calidad@lacumbre.com.ar | password123 |

---

## Decisiones de arquitectura

Ver [docs/architecture.md](docs/architecture.md) para el razonamiento completo detrás de cada decisión.

Resumen ejecutivo:

- **JSONB + JSON Schema en lugar de tablas por punto de control**: evita explosión de tablas, migraciones frecuentes y código duplicado. El costo es que Power BI no lee JSONB nativamente → se resuelve con vistas SQL generadas automáticamente.

- **Generación programática de vistas**: si las vistas se escribieran a mano, cada punto de control nuevo requeriría un desarrollador. El script `generate-views.ts` lee el `schema_json` y genera el DDL automáticamente — el operador del sistema (no un dev) puede agregar puntos de control.

- **API versionada desde el día 1**: cuando se integren balanzas industriales o sensores IoT, el contrato de `/api/v1` no se puede romper. Al versionar desde el inicio, se puede evolucionar a `/api/v2` sin romper integraciones existentes.

- **Separación repository → service → route**: permite testear la lógica de validación sin montar Next.js, y agregar futuros servicios de detección de anomalías o forecasting que lean las mismas tablas sin modificarlas.
