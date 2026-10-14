import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("db/migrations/0029_p0_public_table_hardening.sql","utf8");
const actions=fs.readFileSync("app/(admin)/admin/purchases/actions.ts","utf8");
const cached=fs.readFileSync("src/application/loyverse/cached-catalog-base.ts","utf8");
const allowedTables=[
  "operational_events","loyverse_categories","loyverse_inventory_snapshots",
];
for(const name of allowedTables){
  assert.ok(migration.includes("ALTER TABLE public."+name+" ENABLE ROW LEVEL SECURITY"),
    name+" must have row-level security");
  assert.ok(migration.includes("REVOKE ALL PRIVILEGES ON TABLE public."+name+" FROM anon, authenticated"),
    name+" must not allow public API clients to read or write");
}
assert.doesNotMatch(migration,/\b(DROP|TRUNCATE|DELETE|UPDATE)\s+(TABLE|FROM|public\.)/i,
  "P0 hardening must not alter business data");
const edit=actions.slice(actions.indexOf("export async function saveLoyverseItemSetting"),
  actions.indexOf("export async function generateSuggestedPurchasePlan"));
assert.match(edit,/await db\.transaction\(async \(tx\) => \{/);
assert.match(edit,/await tx[\s\S]*?\.insert\(loyverseItemSettings\)/);
assert.match(edit,/UPDATE public\.ops_catalog_archive_snapshots archive/);
for(const col of ["unitCostOverride","packagePrice","packageQuantityNative","displayFactor","displayUnit"])
  assert.ok(edit.includes("'"+col+"'"),"Cost property missing from snapshot refresh: "+col);
assert.match(edit,/if\(refreshed\.length!==1\)throw new Error/);
assert.match(edit,/await tx\.insert\(auditEvents\)/);
assert.ok(edit.indexOf("UPDATE public.ops_catalog_archive_snapshots")<
  edit.indexOf("await tx.insert(auditEvents)"),"Audit only saved after snapshot sync");
assert.match(edit,/updateTag\(OPS_ARCHIVE_TAG\)/);
assert.ok(edit.indexOf("  });\n  \/\/ Server Action Next 16: caduca")<
  edit.indexOf("updateTag(OPS_ARCHIVE_TAG)"),
  "Invalidate cache only after committed transaction");
assert.match(cached,/tags:\[OPS_ARCHIVE_TAG\]/);
assert.match(cached,/revalidate:LEGACY_LOYVERSE_CACHE_SECONDS/);
console.log("P0 security + costs: PASS (RLS, public permissions, atomic save, read-your-writes cache)");
