import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/src/shared/env";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

export function getDb() {
  if (!client) {
    // En Vercel cada instancia mantiene su propio pool. Limitar conexiones
    // reduce procesos persistentes y tráfico de metadatos de PostgreSQL.
    client = postgres(getServerEnv().DATABASE_URL, { prepare: false, max: 3, idle_timeout: 20 });
  }
  return drizzle(client, { schema });
}
