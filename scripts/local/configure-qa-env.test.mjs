import {test} from "node:test";
import assert from "node:assert/strict";
import {prepareQaEnv} from "./configure-qa-env.mjs";
import {parseEnv,inspectQaSecrets} from "./inspect-qa-secrets.mjs";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const password="abcdef0123456789abcdef0123456789abcdef0123456789";
const required={
 POSTGRES_PASSWORD:password,JWT_SECRET:"h".repeat(45),
 ANON_KEY:"anon-jwt-test",SERVICE_ROLE_KEY:"service-jwt-test",
 SUPABASE_PUBLISHABLE_KEY:"sb_publishable_QaSyntheticNotCommercial_12345",
 SUPABASE_SECRET_KEY:"sb_secret_QaSyntheticNotCommercial_12345",
 JWT_KEYS:"[{\"kty\":\"EC\"}]",JWT_JWKS:"[{\"kty\":\"EC\"}]",
 DASHBOARD_PASSWORD:"StrongPassword1234567",
 SECRET_KEY_BASE:"Z".repeat(64),REALTIME_DB_ENC_KEY:"abcd".repeat(4),
 VAULT_ENC_KEY:"efgh".repeat(8),PG_META_CRYPTO_KEY:"K".repeat(40),
 POOLER_TENANT_ID:"your-tenant-id",DISABLE_SIGNUP:"false",
 ENABLE_EMAIL_SIGNUP:"true",ENABLE_PHONE_SIGNUP:"true",
 ENABLE_ANONYMOUS_USERS:"false",
};
const text=Object.entries(required).map(([key,value])=>key+"="+value).join("\n");
const template=[
 "OPS_LOCAL_FIRST=true","OPS_QA_MODE=true","POS_LIVE_ENABLED=false",
 "DEFAULT_ORGANIZATION_SLUG=cafe-epico-qa","DEFAULT_STORE_CODE=QA-TEPEXI",
 "DATABASE_URL=postgresql://postgres:REEMPLAZAR@127.0.0.1:5432/postgres",
 "NEXT_PUBLIC_SUPABASE_URL=https://192.168.1.100:8443",
 "APP_ORIGIN=https://192.168.1.100:8443",
 "NEXT_PUBLIC_SUPABASE_ANON_KEY=REEMPLAZAR",
 "OPS_LOCAL_CA_FILE=C:/REEMPLAZAR/root.crt",
].join("\n");

test("Sincroniza las claves oficiales y origen local, mantiene Auth público deshabilitado",()=>{
 const {app,stack,origin}=prepareQaEnv({stackText:text,appTemplate:template,
   ip:"192.168.0.172",caPath:"C:\\Users\\inicio\\AppData\\Roaming\\Caddy\\root.crt"});
 const a=parseEnv(app),s=parseEnv(stack);
 assert.equal(origin,"https://192.168.0.172:8443");
 assert.equal(a.APP_ORIGIN,s.SUPABASE_PUBLIC_URL);
 assert.equal(a.NEXT_PUBLIC_SUPABASE_ANON_KEY,s.SUPABASE_PUBLISHABLE_KEY);
 assert.equal(a.DATABASE_URL,"postgresql://postgres.cafe-epico-qa:"+
   password+"@127.0.0.1:5432/postgres");
 assert.equal(a.OPS_LOCAL_CA_FILE,"C:/Users/inicio/AppData/Roaming/Caddy/root.crt");
 assert.equal(s.DISABLE_SIGNUP,"true");
 assert.equal(s.ENABLE_EMAIL_SIGNUP,"false");
 assert.equal(s.ENABLE_PHONE_SIGNUP,"false");
 assert.equal(s.COMPOSE_FILE,"docker-compose.yml");
 assert.ok(inspectQaSecrets(a,s).ok);
 assert.ok(validateLocalQaConfig(a).ok);
 assert.doesNotMatch(app,/REEMPLAZAR|192\.168\.1\.100/);
 assert.equal(app.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=/g)?.length,1);
});

test("Rechaza IP pública o IP de otro equipo sin exponer secretos",()=>{
 for(const ip of ["8.8.8.8","localhost","127.0.0.1","198.51.100.10","192.169.0.1"]){
   assert.throws(()=>prepareQaEnv({stackText:text,appTemplate:template,ip}),/IP privada inválida/);
 }
});
test("No acepta contraseña de ejemplo ni secretos incompletos",()=>{
 assert.throws(()=>prepareQaEnv({stackText:text.replace(password,"your-secret"),appTemplate:template,ip:"192.168.0.172"}),/contraseña|clave/i);
 assert.throws(()=>prepareQaEnv({stackText:text.replace("sb_publishable_QaSyntheticNotCommercial_12345","REEMPLAZAR"),appTemplate:template,ip:"192.168.0.172"}),/clave/i);
});
test("No acepta claves duplicadas (protege de inconsistencias de Compose)",()=>{
 assert.throws(()=>prepareQaEnv({stackText:text+"\nDISABLE_SIGNUP=false",appTemplate:template,ip:"192.168.0.172"}),/duplicada/);
});
