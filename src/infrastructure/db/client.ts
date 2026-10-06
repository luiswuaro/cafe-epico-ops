import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/src/shared/env";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

export function getDb() {
  if (!client) {
    client = postgres(getServerEnv().DATABASE_URL, { prepare: false, max: 10 });
  }
  return drizzle(client, { schema });
}
