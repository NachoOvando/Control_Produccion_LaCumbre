import { defineConfig } from "prisma/config";
import { config as dotenvConfig } from "dotenv";

// El CLI de Prisma no carga .env.local automáticamente (solo Next.js lo hace
// en runtime) — hay que cargarlo acá para que `migrate`/`db push`/`studio`
// tengan DIRECT_URL disponible.
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

// El CLI (migraciones, studio) necesita conexión directa a Postgres (puerto
// 5432), no el pooler de transacciones (DATABASE_URL, PgBouncer 6543) que usa
// el runtime — PgBouncer en modo transaction no soporta las operaciones que
// el CLI necesita (advisory locks, DDL de migración). Ver ADR-014 en
// docs/architecture.md.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
