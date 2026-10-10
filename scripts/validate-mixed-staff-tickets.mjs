import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-mixed-ticket-"));
try{
  const source=fs.readFileSync(path.join(process.cwd(),"src/domain/pos/staff-ticket.ts"),"utf8");
  fs.writeFileSync(path.join(dir,"ticket.cjs"),ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText);
  const {calculateStaffTicket:quote,calculateMixedTicketSettlement:settle}=
    createRequire(path.join(dir,"run.cjs"))("./ticket.cjs");
  const customer={key:"a",name:"Latte cliente",category:"CALIENTES",basePrice:70,extrasPrice:0,
    ownThermos:false,serviceMode:"DINE_IN",staffBenefit:"NONE",employeeId:null};
  const free={key:"b",name:"Latte personal",category:"CALIENTES",basePrice:60,extrasPrice:0,
    ownThermos:false,serviceMode:"DINE_IN",staffBenefit:"INCLUDED_DRINK",employeeId:"azucena"};
  const additional={key:"c",name:"Moka trabajador",category:"FRÍAS",basePrice:80,extrasPrice:10,
    ownThermos:false,serviceMode:"DINE_IN",staffBenefit:"ADDITIONAL_10",employeeId:"otro"};
  // Regla de caja: un cliente identificado bloquea cualquier beneficio de personal.
  let t=quote([customer,free],"cliente-registrado");
  assert.equal(t.valid,false);
  assert.equal(t.staffDiscount,0);
  assert.ok(t.warnings.some(w=>w.includes("Ticket con cliente registrado")));
  assert.throws(()=>settle(t,0),/Cotización inválida/);
  t=quote([customer,additional],"cliente-registrado");
  assert.equal(t.valid,false);
  assert.equal(t.staffDiscount,0);
  t=quote([customer],"cliente-registrado");
  assert.equal(t.valid,true);
  assert.equal(t.customerEligibleTotal,70);
  assert.equal(settle(t,20).earnedPoints,2.5);
  t=quote([free],"cliente-registrado");
  assert.equal(t.valid,false);
  assert.equal(t.staffDiscount,0);
  // Sin cliente, el trabajador puede recibir el beneficio en su ticket propio.
  t=quote([free],null);
  assert.equal(t.valid,true);
  assert.equal(t.staffDiscount,60);
  t=quote([customer,free]); // Tickets sin cliente identificado: legacy test
  assert.equal(t.valid,true);
  assert.equal(t.listedTotal,130);
  assert.equal(t.staffDiscount,60);
  assert.equal(t.customerEligibleTotal,70);
  assert.equal(t.staffPayable,0);
  assert.deepEqual(settle(t,20),{customerDue:50,staffDue:0,totalDue:50,earnedPoints:2.5});
  t=quote([customer,free,additional]);
  assert.equal(t.valid,true);
  assert.equal(t.listedTotal,220);
  assert.equal(t.staffDiscount,68);
  assert.equal(t.staffPayable,82); // $80 base − 10% + $10 extra
  assert.equal(t.customerEligibleTotal,70);
  assert.deepEqual(settle(t,20),{customerDue:50,staffDue:82,totalDue:132,earnedPoints:2.5});
  assert.throws(()=>settle(t,80),/cliente/);
  // Ticket sin cliente y dos consumos personal: no hay puntos de lealtad.
  t=quote([free,additional]);
  assert.equal(t.customerEligibleTotal,0);
  assert.equal(t.staffPayable,82);
  assert.deepEqual(settle(t,0),{customerDue:0,staffDue:82,totalDue:82,earnedPoints:0});
  assert.throws(()=>settle(t,1),/cliente/);
  // Azucena: bebida gratis sólo para aquí, se cobra si está para llevar.
  t=quote([{...free,serviceMode:"TAKEAWAY"}]);
  assert.equal(t.valid,false);
  assert.equal(t.staffDiscount,0);
  assert.ok(t.warnings.some(w=>w.includes("solo para consumir aquí")));
  // 10% de descuento sí se aplica para llevar, con empaque normal.
  t=quote([{...additional,employeeId:"azucena",serviceMode:"TAKEAWAY"}]);
  assert.equal(t.valid,true);
  assert.equal(t.staffDiscount,8);
  assert.equal(t.staffPayable,82);
  // Ticket no identificado: se verifica cotización antigua sin cliente registrado.
  // La interfaz operativa ofrece crear tickets separados.
  t=quote([{...customer,serviceMode:"TAKEAWAY"},free]);
  assert.equal(t.valid,true);
  assert.equal(t.customerEligibleTotal,70);
  assert.equal(settle(t,20).earnedPoints,2.5);
  t=quote([free,{...free,key:"d",employeeId:"otro"}]);
  assert.equal(t.valid,true); // Dos empleados distintos, ambos con bebida incluida.
  assert.equal(t.staffDiscount,120);
  t=quote([free,{...free,key:"d"}]);
  assert.equal(t.valid,false); // Dos cortesías mismo trabajador en un ticket.
  t=quote([{...additional,employeeId:null}]);
  assert.equal(t.valid,false);
  t=quote([{...free,ownThermos:true}]);
  assert.equal(t.valid,false); // No acumular termo y descuento de personal.
  t=quote([{...customer,ownThermos:true},free]);
  assert.equal(t.valid,true); // Cliente con termo y empleado en misma cuenta: válido.
  assert.equal(t.customerEligibleTotal,65);
  assert.equal(settle(t,30).earnedPoints,1.75);
  t=quote([{...customer,category:"ALIMENTOS",staffBenefit:"INCLUDED_DRINK",employeeId:"azucena"}]);
  assert.equal(t.valid,false);
  console.log("POS mixed staff/customer preview: PASS");
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
