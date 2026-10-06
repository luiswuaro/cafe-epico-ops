import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  DEFAULT_ORGANIZATION_SLUG: z.string().default("cafe-epico"),
  DEFAULT_STORE_CODE: z.string().default("TEPEXI"),
  CRON_SECRET: z.string().min(20).optional(),
  LOYVERSE_ACCESS_TOKEN: z.string().min(1).optional(),
  LOYVERSE_WEBHOOK_CLIENT_SECRET: z.string().min(1).optional(),
  LOYVERSE_WEBHOOK_INGEST_TOKEN: z.string().min(20).optional(),
  LOYVERSE_MERCHANT_ID: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function getServerEnv(): ServerEnv {
  return serverSchema.parse(process.env);
}
