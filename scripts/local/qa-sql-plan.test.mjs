import assert from "node:assert/strict";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {readFileSync} from "node:fs";
import {migrationPlan,qaSeed,checksum} from "./qa-sql-plan.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
test("lista TODAS las migraciones de manera determinista y con SHA-256",()=>{
  const migrations=migrationPlan(resolve(root,"db/migrations"));
  assert.ok(migrations.length>=25);
  assert.equal(migrations[0].name,"0000_v0_1_core.sql");
  assert.equal(new Set(migrations.map(m=>m.name)).size,migrations.length);
  assert.deepEqual(migrations.map(m=>m.name),migrations.map(m=>m.name).sort());
  assert.ok(migrations.every(m=>/^[a-f0-9]{64}$/.test(m.sha256)&&m.content.length>0));
});
test("seed QA preserva UUIDs y sólo cambia identidad de comercio",()=>{
  const original=readFileSync(resolve(root,"db/seed.sql"),"utf8");
  const changed=qaSeed(original);
  assert.ok(changed.includes("'cafe-epico-qa'"));
  assert.ok(changed.includes("'QA-TEPEXI'"));
  assert.ok(!changed.includes("'cafe-epico'"));
  assert.notEqual(checksum(original),checksum(changed));
});
test("rechaza seeds inesperados",()=>{
  assert.throws(()=>qaSeed("INSERT INTO organizations VALUES ('otro');"));
});
