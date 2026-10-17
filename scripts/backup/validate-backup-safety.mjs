import assert from "node:assert/strict";
import fs from "node:fs";

const dump=fs.readFileSync("scripts/backup/backup-ops.sh","utf8");
const inspect=fs.readFileSync("scripts/backup/inspect-ops-backup.sh","utf8");
const notes=fs.readFileSync("docs/operations/backup-and-multistore-readiness.md","utf8");

for(const [name,source] of [["backup",dump],["inspect",inspect]]) {
  assert.match(source,/set -Eeuo pipefail/,name+": detectar fallos de subprocesos");
  assert.match(source,/umask 077/,name+": archivos privados");
  assert.match(source,/trap .* EXIT/,name+": limpieza de temporales");
}
assert.match(dump,/--format=custom/);
for(const schema of ["public","auth","storage"])
  assert.ok(dump.includes("--schema="+schema),"Falta esquema "+schema);
assert.match(dump,/pg_dump[\s\S]*\| age --recipient/,
 "Cifrar en stream; no crear archivo de backup sin cifrar");
assert.match(dump,/OPS_BACKUP_AGE_RECIPIENT/);
assert.match(dump,/OPS_BACKUP_DATABASE_URL/);
assert.match(dump,/sha256sum/);
assert.match(dump,/mv -- "\$workdir\/archive\.age" "\$archive"/);
assert.doesNotMatch(dump,/pg_dump.*\-\-file=|pg_dump.*>.*\.dump|pg_dump.*>.*\.custom/,
 "Nunca persistir volcado sin cifrar desde pg_dump");
assert.match(inspect,/age --decrypt/);
assert.match(inspect,/sha256sum/);
assert.match(inspect,/pg_restore --list/);
assert.match(inspect,/pg_restore --file \/dev\/null/);
assert.doesNotMatch(inspect,/pg_restore.*--dbname|psql.*-f /,
 "La inspeccion no debe conectarse a ninguna BD ni ejecutar SQL");
for(const table of ["pos_orders","pos_payments","inventory_movements","pos_customers","pos_loyalty_entries","auth users"])
  assert.ok(inspect.includes(table),"Inspeccion incompleta: "+table);
for(const phrase of ["Restaurar en instancia","No cambiar","Fase 1"])
  assert.ok(notes.includes(phrase),"Falta restriccion operativa: "+phrase);
console.log("BACKUP SAFE: PASS — encrypted stream, checksums, scope and no restore writes");
