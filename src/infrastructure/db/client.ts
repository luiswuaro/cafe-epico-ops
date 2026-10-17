import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/src/shared/env";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

export function getDb() {
  if (!client) {
    // Vercel: conservar dos conexiones para no saturar Supabase cloud.
    // PC local: un único servidor Node atiende POS, comandas e impresión;
    // ocho conexiones permiten transacciones simultáneas sin multiplicar
    // pools por cada celular. Todo sigue en PostgreSQL ACID.
    const localServer=process.env.OPS_LOCAL_FIRST==="true";
    client = postgres(getServerEnv().DATABASE_URL, {
      prepare: false,
      max: localServer ? 8 : 2,
      idle_timeout: localServer ? 30 : 90,
      connect_timeout: 10,
    });
  }
  return drizzle(client, { schema });
}
