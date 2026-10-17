import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const terraform=readFileSync("infra/oracle/probe/main.tf","utf8");
const action=readFileSync(".github/workflows/oracle-connection-check.yml","utf8");
const docs=readFileSync("docs/operations/oracle-connectivity-pilot.md","utf8");

assert.match(terraform,/data "oci_identity_availability_domains"/);
assert.match(terraform,/output "availability_domain_count"/);
assert.doesNotMatch(terraform,/^\s*resource\s+"/m,"El piloto no debe crear recursos");
assert.doesNotMatch(terraform,/^\s*module\s+"/m,"El piloto no debe introducir módulos");
assert.match(action,/workflow_dispatch:/);
assert.match(action,/permissions:\s*\n\s*contents: read/);
assert.match(action,/terraform -chdir=infra\/oracle\/probe plan/);
assert.doesNotMatch(action,/\bterraform\s+apply\b|\boci\s+compute\s+instance\s+launch\b/,
  "El workflow de diagnóstico nunca puede provisionar infraestructura");
assert.match(action,/OCI_API_PRIVATE_KEY: \$\{\{ secrets\.OCI_API_PRIVATE_KEY \}\}/);
assert.match(action,/OCI_PRIVATE_KEY_PATH=/);
assert.match(action,/terraform show -json/);
assert.match(action,/change\.get\("mode"\)=="managed"/);
assert.match(docs,/NO conectado a una cuenta Oracle real/);
assert.match(docs,/No configuramos automatización con llaves permanentes de administrador/);
console.log("ORACLE READ ONLY: PASS (no managed resources, no apply, secrets masked, manual trigger)");
