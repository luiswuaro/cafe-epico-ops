import { z } from "zod";

const rawServerSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
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

type RawServerEnv = z.infer<typeof rawServerSchema>;

export type ServerEnv = RawServerEnv & {
  DATABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
};

export function getServerEnv(): ServerEnv {
  const parsed = rawServerSchema.parse(process.env);
  const databaseUrl = parsed.DATABASE_URL ?? parsed.POSTGRES_URL;
  const supabaseKey =
    parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL or POSTGRES_URL");
  }

  if (!supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return {
    ...parsed,
    DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseKey,
  };
}
