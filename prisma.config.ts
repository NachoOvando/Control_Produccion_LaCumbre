import { defineConfig } from "prisma/config";
import { config as dotenvConfig } from "dotenv";

// El CLI de Prisma no carga .env.local automáticamente (solo Next.js lo hace
// en runtime) — hay que cargarlo acá para que `migrate`/`db push`/`studio`
// tengan DATABASE_URL disponible.
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
