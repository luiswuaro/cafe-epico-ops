import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-receipt-loyalty-"));
try{
 const source=fs.readFileSync("src/domain/pos/receipt-loyalty.ts","utf8");
 const compiled=ts.transpileModule(source,{compilerOptions:{
   target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
 }}).outputText;
 const dest=path.join(dir,"receipt-loyalty.cjs");
 fs.writeFileSync(dest,compiled);
 const {receiptLoyaltyView}=createRequire(import.meta.url)(dest);
 const rows=[
  {customerId:"cliente1",name:"Cliente ejemplo",balance:"27.50",points:"3.50",note:"Cuenta 1 · Compra"},
  {customerId:"cliente1",name:"Cliente ejemplo",balance:"27.50",points:"2.00",note:"Cuenta 2 · Compra"},
 ];
 const full=receiptLoyaltyView({entries:rows,fallbackCustomer:"Cliente ejemplo"});
 assert.equal(full.customer,"Cliente ejemplo");
 assert.equal(full.pointsEarned,"5.50");
 assert.equal(full.pointsBalance,"27.50");
 const split=receiptLoyaltyView({entries:rows,splitLabel:"Cuenta 1"});
 assert.equal(split.pointsEarned,"3.50");
 assert.equal(split.pointsBalance,"27.50");
 const none=receiptLoyaltyView({entries:[],splitLabel:"Cuenta 3",fallbackCustomer:"Otro"});
 assert.equal(none.customer,null);
 assert.equal(none.pointsEarned,null);
 assert.equal(none.pointsBalance,null);
 const cancelled=receiptLoyaltyView({entries:rows,cancelled:true});
 assert.equal(cancelled.pointsEarned,null);
 assert.equal(cancelled.pointsBalance,null);
 const zero=receiptLoyaltyView({entries:[{
  customerId:"cliente1",name:"Cliente ejemplo",balance:"0",points:"0",note:"Compra",
 }]});
 assert.equal(zero.pointsEarned,"0.00");
 assert.equal(zero.pointsBalance,"0.00");
 console.log("RECIBOS: puntos completos en normal, cuentas divididas, sin crédito, canceladas y saldo cero");
}finally{fs.rmSync(dir,{recursive:true,force:true});}
