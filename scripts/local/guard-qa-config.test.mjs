import assert from "node:assert/strict";
import {test} from "node:test";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const valid={
  DATABASE_URL:"postgresql://test:private@127.0.0.1:5432/postgres",
  NEXT_PUBLIC_SUPABASE_URL:"https://192.168.1.200:8443",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:"local_public_test_only",
  APP_ORIGIN:"https://192.168.1.200:8443",
  DEFAULT_ORGANIZATION_SLUG:"cafe-epico-qa",
  OPS_QA_MODE:"true",
  OPS_LOCAL_FIRST:"true",
  POS_LIVE_ENABLED:"false",
};
test("local pilot accepts isolated PostgreSQL/Auth/private HTTPS + QA, no production writes",()=>{
  assert.deepEqual(validateLocalQaConfig(valid),{ok:true,errors:[]});
});
for(const [name,override] of [
  ["reject Supabase cloud database",{DATABASE_URL:"postgresql://test:private@db.example.supabase.co:5432/postgres"}],
  ["reject other server DB",{DATABASE_URL:"postgresql://test:private@192.168.1.2:5432/postgres"}],
  ["reject public Auth",{NEXT_PUBLIC_SUPABASE_URL:"https://acme.supabase.co"}],
  ["reject public APP_ORIGIN",{APP_ORIGIN:"https://cafe-epico.vercel.app"}],
  ["reject HTTP Auth",{NEXT_PUBLIC_SUPABASE_URL:"http://192.168.1.200:8000"}],
  ["reject HTTP application",{APP_ORIGIN:"http://192.168.1.200:3000"}],
  ["reject real business org",{DEFAULT_ORGANIZATION_SLUG:"cafe-epico"}],
  ["reject live sales",{POS_LIVE_ENABLED:"true"}],
  ["reject absent QA flag",{OPS_QA_MODE:"false"}],
  ["reject Vercel",{VERCEL_ENV:"production"}],
  ["reject missing DB",{DATABASE_URL:undefined}],
  ["reject placeholder public key",{NEXT_PUBLIC_SUPABASE_ANON_KEY:"REEMPLAZAR"}],
]){
  test(name,()=>{
    const result=validateLocalQaConfig({...valid,...override});
    assert.equal(result.ok,false);
    assert.ok(result.errors.length>0);
    assert.ok(!JSON.stringify(result.errors).includes("private"),"Nunca filtrar credenciales");
  });
}
