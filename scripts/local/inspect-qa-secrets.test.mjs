import assert from "node:assert/strict";
import { test } from "node:test";
import {inspectQaSecrets,parseEnv} from "./inspect-qa-secrets.mjs";

const origin="https://192.168.1.111:8443";
const app={
  APP_ORIGIN:origin,NEXT_PUBLIC_SUPABASE_URL:origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:"sb_publishable_local_test",
};
const stack={
  POSTGRES_PASSWORD:"Fh17hq3vgtsfLa4YSpBu",
  JWT_SECRET:"Abcdefghij1234567890Abcdefghij1234567890",
  ANON_KEY:"encoded-local-test-key",SERVICE_ROLE_KEY:"encoded-service-key",
  SUPABASE_PUBLISHABLE_KEY:"sb_publishable_local_test",
  SUPABASE_SECRET_KEY:"sb_secret_local_test",JWT_KEYS:"[{\"kty\":\"EC\"}]",
  JWT_JWKS:"[{\"kty\":\"EC\"}]",
  DASHBOARD_PASSWORD:"QaAdmin1234567890",
  SECRET_KEY_BASE:"010203040506070809010203040506070809",
  REALTIME_DB_ENC_KEY:"1234567890abcdef",VAULT_ENC_KEY:"1234567890abcdef1234567890abcdef",
  PG_META_CRYPTO_KEY:"abcdef1234567890abcdef1234567890",
  POOLER_TENANT_ID:"cafe-epico-qa",
  DISABLE_SIGNUP:"true",ENABLE_EMAIL_SIGNUP:"true",
  ENABLE_PHONE_SIGNUP:"false",ENABLE_ANONYMOUS_USERS:"false",
  SUPABASE_PUBLIC_URL:origin,SITE_URL:origin,
  API_EXTERNAL_URL:origin+"/auth/v1",COMPOSE_FILE:"docker-compose.yml",
};
test("valida configuración local con secretos distintos del ejemplo",()=>{
  assert.deepEqual(inspectQaSecrets(app,stack),{ok:true,errors:[]});
});
test("rechaza secretos de demostración",()=>{
  assert.equal(inspectQaSecrets(app,{...stack,POSTGRES_PASSWORD:"your-super-secret"}).ok,false);
});
test("permite login por correo sólo cuando las altas públicas están bloqueadas",()=>{
  assert.equal(inspectQaSecrets(app,{...stack,ENABLE_EMAIL_SIGNUP:"true",DISABLE_SIGNUP:"true"}).ok,true);
  assert.equal(inspectQaSecrets(app,{...stack,ENABLE_EMAIL_SIGNUP:"false"}).ok,false);
  assert.equal(inspectQaSecrets(app,{...stack,DISABLE_SIGNUP:"false"}).ok,false);
});
test("rechaza divergencia de origen, claves y Compose",()=>{
  assert.equal(inspectQaSecrets({...app,APP_ORIGIN:"https://otra.local"},stack).ok,false);
  assert.equal(inspectQaSecrets({...app,NEXT_PUBLIC_SUPABASE_ANON_KEY:"otra"},stack).ok,false);
  assert.equal(inspectQaSecrets(app,{...stack,COMPOSE_FILE:"docker-compose.yml:otro.yml"}).ok,false);
});
test("lee .env sin divulgar secretos",()=>{
  assert.deepEqual(parseEnv("A=1\n# comentario\nB=\"hola\"\n"),{A:"1",B:"hola"});
});
