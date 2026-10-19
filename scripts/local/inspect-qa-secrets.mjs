import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** No devuelve ni imprime valores. Revisión previa al arranque de la réplica QA. */
export function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) result[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return result;
}

export function inspectQaSecrets(app, stack) {
  const errors=[];
  const needed=[
    "POSTGRES_PASSWORD","JWT_SECRET","ANON_KEY","SERVICE_ROLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY","JWT_KEYS","JWT_JWKS",
    "DASHBOARD_PASSWORD","SECRET_KEY_BASE","REALTIME_DB_ENC_KEY",
    "VAULT_ENC_KEY","PG_META_CRYPTO_KEY","POOLER_TENANT_ID",
  ];
  const sample=/(your-|super-secret|insecure|fake_|change.me|reemplazar|sk-proj-xxxx)/i;
  for (const key of needed) {
    const value=stack[key];
    if (!value || sample.test(value)) errors.push(key+": falta valor seguro generado.");
  }
  if (stack.DASHBOARD_PASSWORD && !/^[A-Za-z0-9]{16,}$/.test(stack.DASHBOARD_PASSWORD))
    errors.push("DASHBOARD_PASSWORD: usar alfanumérico de al menos 16 caracteres.");
  if (stack.POSTGRES_PASSWORD && stack.POSTGRES_PASSWORD.length<20)
    errors.push("POSTGRES_PASSWORD: mínimo 20 caracteres.");
  if (stack.ENABLE_EMAIL_SIGNUP !== "true")
    errors.push("Auth QA: habilitar proveedor de correo para permitir iniciar sesión.");
  if (stack.ENABLE_PHONE_SIGNUP !== "false" || stack.DISABLE_SIGNUP !== "true")
    errors.push("Auth QA: bloquear altas públicas y el proveedor telefónico.");
  if (stack.ENABLE_ANONYMOUS_USERS !== "false")
    errors.push("Auth QA: deshabilitar usuarios anónimos.");
  const origin=app.APP_ORIGIN?.replace(/\/$/, "");
  const url=app.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!origin || origin!==url) errors.push("OPS QA: APP_ORIGIN y Auth URL deben ser el mismo HTTPS privado.");
  if (!origin || stack.SUPABASE_PUBLIC_URL!==origin ||
      stack.SITE_URL!==origin || stack.API_EXTERNAL_URL!==origin+"/auth/v1")
    errors.push("Supabase QA: configurar SUPABASE_PUBLIC_URL, SITE_URL y API_EXTERNAL_URL con el HTTPS privado de OPS.");
  if (!app.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      app.NEXT_PUBLIC_SUPABASE_ANON_KEY!==stack.SUPABASE_PUBLISHABLE_KEY)
    errors.push("OPS QA: clave publicable distinta a la del servidor Auth local.");
  if (stack.COMPOSE_FILE && stack.COMPOSE_FILE!=="docker-compose.yml")
    errors.push("Supabase QA: COMPOSE_FILE debe ser sólo docker-compose.yml; el override se añade explícitamente.");
  return {ok:errors.length===0,errors};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [appPath,stackPath]=process.argv.slice(2);
    if (!appPath || !stackPath) throw new Error("Faltan rutas");
    const result=inspectQaSecrets(
      parseEnv(readFileSync(appPath,"utf8")),
      parseEnv(readFileSync(stackPath,"utf8")),
    );
    if (result.ok) console.log("PASS: secretos QA configurados y dominio HTTPS local coherente.");
    else { for (const e of result.errors) console.error("BLOQUEADO: "+e); process.exitCode=2; }
  } catch {
    console.error("BLOQUEADO: imposible inspeccionar los archivos QA.");
    process.exitCode=2;
  }
}
