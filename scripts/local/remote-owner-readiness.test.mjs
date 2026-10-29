import test from "node:test";
import assert from "node:assert/strict";
import { parseDotenv, privateIpv4, remoteOwnerReadiness } from "./remote-owner-readiness.mjs";

const ip = "192.168.0.172";
const origin = `https://${ip}:8443`;
const appText = `APP_ORIGIN=${origin}\nNEXT_PUBLIC_SUPABASE_URL=${origin}\nOPS_LOCAL_CA_FILE=C:/caddy/root.crt\nSERVICE_ROLE_KEY=NO_SE_DEBE_MOSTRAR`;
const authText = `SITE_URL=${origin}\nAPI_EXTERNAL_URL=${origin}/auth/v1\nSUPABASE_PUBLIC_URL=${origin}`;
const caddyText = `auto_https disable_redirects\nhttps://{$OPS_LAN_HOST}:8443 {\n bind {$OPS_LAN_HOST}\n tls internal\n @supabase path /auth/v1/* /rest/v1/*\n handle @supabase { reverse_proxy 127.0.0.1:8000 }\n handle /api/local-print-agent* { respond "Forbidden" 403 }\n handle { reverse_proxy 127.0.0.1:3000 }\n}`;
const baseline = { appText, authText, caddyText, caPresent: true };

test("acepta exclusivamente redes privadas IPv4", () => {
  for (const ip of ["10.1.1.10", "172.16.0.1", "172.31.255.10", "192.168.1.1"]) assert.equal(privateIpv4(ip), true);
  for (const ip of ["0.0.0.0", "127.0.0.1", "172.32.0.1", "192.169.1.1", "8.8.8.8", "ejemplo.com", "::1"]) assert.equal(privateIpv4(ip), false);
});

test("no filtra comentarios a la configuración", () => {
  assert.deepEqual(parseDotenv("# comentario\nSITE_URL='https://foo' # extra\nKEY=abc # comentario\n"), { SITE_URL: "https://foo", KEY: "abc" });
});

test("acepta el esquema de OPS local sin mostrar claves", () => {
  const result = remoteOwnerReadiness(baseline);
  assert.equal(result.ready, true, JSON.stringify(result.checks));
  assert.equal(result.cidr, `${ip}/32`);
  assert.doesNotMatch(JSON.stringify(result), /NO_SE_DEBE_MOSTRAR/);
});

test("bloquea esquemas públicos, puertos adicionales y rutas Auth diferentes", () => {
  for (const changed of [
    { appText: appText.replace(origin, "https://cafe.example.com") },
    { appText: appText.replace(origin, "http://192.168.0.172:8443") },
    { appText: appText.replaceAll("8443", "3000") },
    { authText: authText.replace("SITE_URL=", "SITE_URL=https://otro.example.com/") },
    { caddyText: caddyText.replace('respond "Forbidden" 403', 'respond "OK" 200') },
    { caddyText: caddyText.replace("bind {$OPS_LAN_HOST}", "bind 0.0.0.0") },
    { caPresent: false },
    { authText: null },
  ]) {
    const result = remoteOwnerReadiness({ ...baseline, ...changed });
    assert.equal(result.ready, false, JSON.stringify(changed));
  }
});
