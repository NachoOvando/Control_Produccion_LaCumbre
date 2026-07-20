import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Singleton de PrismaClient para evitar múltiples instancias en desarrollo (hot reload)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está definida en el entorno");

  // NO agregar `statementNameGenerator` a estas options sin antes revisar el
  // ADR correspondiente en docs/architecture.md — sin ese callback,
  // @prisma/adapter-pg emite prepared statements sin nombre (no cacheados),
  // que es lo que los hace compatibles con el pooler de transacciones de
  // Supabase (PgBouncer, 6543). Agregarlo reintroduce en silencio el bug
  // conocido Prisma+PgBouncer. Ver ADR-014.
  const adapter = new PrismaPg({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
