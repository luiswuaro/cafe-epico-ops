import assert from "node:assert/strict";
import {test} from "node:test";
import {assessLocalBackup} from "./local-backup-policy.mjs";
const origin="/tmp/project";
const valid={
 OPS_LOCAL_FIRST:"true",
 DATABASE_URL:"postgresql://user:secret@127.0.0.1:5432/postgres",
 OPS_BACKUP_AGE_RECIPIENT:"age1"+"a".repeat(58),
 OPS_BACKUP_DESTINATION:"/tmp/private-usb-backup"
};
test("acepta únicamente copia local cifrada fuera del repositorio",()=>{
 const r=assessLocalBackup(valid,origin);
 assert.equal(r.ok,true);assert.equal(r.errors.length,0);
});
for(const [name,override] of [
 ["rechaza Supabase.com",{DATABASE_URL:"postgresql://user:secret@db.example.supabase.co:5432/postgres"}],
 ["rechaza IP remota",{DATABASE_URL:"postgresql://user:secret@192.168.1.10:5432/postgres"}],
 ["rechaza otra base",{DATABASE_URL:"postgresql://user:secret@127.0.0.1:5432/some_other_db"}],
 ["rechaza Vercel",{VERCEL_ENV:"production"}],
 ["rechaza clave ausente",{OPS_BACKUP_AGE_RECIPIENT:""}],
 ["rechaza directorio de repositorio",{OPS_BACKUP_DESTINATION:"/tmp/project/local"}],
 ["rechaza uso no local",{OPS_LOCAL_FIRST:"false"}],
])test(name,()=>{
 const r=assessLocalBackup({...valid,...override},origin);
 assert.equal(r.ok,false);
 assert.ok(!JSON.stringify(r.errors).includes("secret"));
});
