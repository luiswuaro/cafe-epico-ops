import Link from "next/link";
import {and,eq} from "drizzle-orm";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getDb} from "@/src/infrastructure/db/client";
import {suppliers} from "@/src/infrastructure/db/schema";
import {listActiveInventoryItems} from "@/src/application/inventory/items";
import {getOpsInventoryIntelligence} from "@/src/application/inventory/ops-intelligence";
import {getOpsReplenishmentQueue} from "@/src/application/pos/replenishment";
import type {InventorySeed} from "@/src/domain/purchases/abastecimiento-plan";
import {AbastoWorkbench} from "./abasto-workbench";
import "./abasto-preview.css";

export const dynamic="force-dynamic";

export default async function AbastoPreviewPage(){
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Se requiere una sucursal activa.");
  await assertEmployeePermission(employee.id,"purchase.manage",employee.homeStoreId);
  const db=getDb();
  const [inventory,forecast,queue,supplierRows]=await Promise.all([
    listActiveInventoryItems(employee.organizationId),
    getOpsInventoryIntelligence(employee.organizationId,employee.homeStoreId),
    getOpsReplenishmentQueue(employee.organizationId,employee.homeStoreId),
    db.select({id:suppliers.id,name:suppliers.name,city:suppliers.city})
      .from(suppliers).where(and(
        eq(suppliers.organizationId,employee.organizationId),
        eq(suppliers.isActive,true))),
  ]);
  const byHistory=new Map(forecast.smartRows.map(x=>[x.variantExternalId,x]));
  const byAlert=new Map(queue.all.map(x=>[x.id,x]));
  const seeds:InventorySeed[]=inventory
    .filter(x=>x.canonicalUnit==="g"||x.canonicalUnit==="ml"||x.canonicalUnit==="pz")
    .map(item=>{
      const observed=byHistory.get(item.id),alert=byAlert.get(item.id);
      return {id:item.id,name:item.name,unit:item.canonicalUnit,
        stock:observed?.inStock??alert?.balance??null,
        daily:forecast.sampleDays>=3&&observed&&observed.avgDailyUsage14>0
          ?observed.avgDailyUsage14:null,
        minimum:item.minimumStock===null?null:Number(item.minimumStock),
        severity:alert?.severity??"SIN_ALERTA"};
    }).sort((a,b)=>a.name.localeCompare(b.name,"es"));
  return <main className="shell ops-admin-workspace abp">
    <header className="abp-head">
      <div>
        <p className="eyebrow">CAFÉ ÉPICO OPS · PREVIEW DE SOLO LECTURA</p>
        <h1>Abastecimiento y logística</h1>
        <p className="muted">Viaje semanal para perecederos, compras por caja cuando sean financiables,
          y prioridades basadas en efectivo disponible. Inventario OPS consultado sin modificar existencias.</p>
      </div>
      <Link className="button" href="/admin">Volver a administración</Link>
    </header>
    <p className="abp-warning" role="status">
      PREVIEW AISLADA · Las decisiones, precios, viajes y recepciones de este simulador NO crean
      compras, gastos, rutas ni movimientos de inventario. No se usa Loyverse.
    </p>
    <AbastoWorkbench seeds={seeds} suppliers={supplierRows.map(s=>s.name+(s.city?" · "+s.city:""))}
      observedDays={forecast.sampleDays} />
  </main>;
}
