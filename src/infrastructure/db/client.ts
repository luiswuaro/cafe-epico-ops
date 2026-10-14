import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/src/shared/env";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

export function getDb() {
  if (!client) {
    // Cada instancia serverless comparte este pool durante su vida útil.
    // Máximo dos conexiones permite caja/impresión concurrentes sin abrir
    // tres sesiones TLS por instancia; conservarlas brevemente amortiza
    // los picos de reconexiones del pooler entre polls de 4 segundos.
    // Transacciones, RLS y consultas siguen ejecutándose en PostgreSQL.
    client = postgres(getServerEnv().DATABASE_URL, {
      prepare: false,
      max: 2,
      idle_timeout: 90,
      connect_timeout: 10,
    });
  }
  return drizzle(client, { schema });
}
