import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { posCustomers } from "@/src/infrastructure/db/schema";
import { getOrderSplitState } from "@/src/application/pos/splits";
import { selectedKitchenSlip, kitchenCategoryLabel, kitchenOrderIdentity } from "@/src/application/pos/kitchen-slip";
import {preparationNote} from "@/src/application/pos/extras";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { KitchenPrintButton } from "../../kitchen-print-button";
import { PrintTicketButton } from "../../../receipt/[id]/print-button";

export const dynamic="force-dynamic";

export default async function KitchenSlipPage({params,searchParams}:{
  params:Promise<{id:string}>;
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}){
  const {id}=await params;
  const q=await searchParams;
  const selection=q.round==="all"?"all" as const:"latest" as const;
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const state=await getOrderSplitState(employee.organizationId,employee.homeStoreId,id);
  if(!state||(state.order.mode!=="LIVE"&&state.order.mode!=="SHADOW"))
    throw new Error("Comanda no encontrada");
  if(state.order.status==="CANCELLED")throw new Error("No se imprimen comandas canceladas");
  const client=state.order.customerId
    ?(await getDb().select({name:posCustomers.name}).from(posCustomers)
      .where(and(eq(posCustomers.id,state.order.customerId),
        eq(posCustomers.organizationId,employee.organizationId))).limit(1))[0]
    :null;
  const slip={
    folio:state.order.folio,
    ...kitchenOrderIdentity({
      ticketLabel:state.order.tableLabel,
      customerName:client?.name,
      folio:state.order.folio,
    }),
    orderNote:state.order.note,
    lines:state.lines.map(row=>({
      id:row.id,name:row.nameSnapshot,category:row.categorySnapshot,
      quantity:Number(row.quantity),note:preparationNote(row.note,row.expectedConsumption),
      serviceMode:typeof row.expectedConsumption?.serviceMode==="string"
        ?row.expectedConsumption.serviceMode:null,
      roundId:typeof row.expectedConsumption?.roundId==="string"
        ?row.expectedConsumption.roundId:null,
    })),
  };
  const selected=selectedKitchenSlip(slip,selection);
  const now=new Date().toLocaleString("es-MX",{
    timeZone:"America/Mexico_City",hour:"2-digit",minute:"2-digit",
  });
  return <main className="receipt-shell">
    <div className="receipt-toolbar no-print">
      <Link href="/pos/orders" className="button">Volver a comandas</Link>
      <PrintTicketButton/>
    </div>
    <section className="card no-print" style={{marginBottom:12}}>
      <h2>Comanda de preparación</h2>
      <p className="muted">Sin importes ni datos de cobro. Imprimir no descuenta inventario.</p>
      {state.order.mode==="SHADOW"&&<p className="status-warn">
        IMPRESIÓN DE PRUEBA: esta comanda es espejo; sólo se envía papel a la impresora local.
      </p>}
      <KitchenPrintButton slip={slip}
        viewUrl={"/pos/orders/"+id+"/kitchen?round="+(selection==="latest"?"all":"latest")}/>
      <div className="pos-context-links" style={{marginTop:12}}>
        <Link className="button" href={"/pos/orders/"+id+"/kitchen"}>Última ronda</Link>
        <Link className="button" href={"/pos/orders/"+id+"/kitchen?round=all"}>Todo el pedido</Link>
      </div>
    </section>
    <article className="receipt-paper kitchen-slip-paper">
      <header>
        <p className="kitchen-slip-heading">COMANDA BARRA</p>
        <h1 className="kitchen-slip-table">{slip.table}</h1>
        {slip.customerName&&<p><strong>CLIENTE: {slip.customerName}</strong></p>}
        <p><strong>{selected.roundLabel} · {now}</strong></p>
      </header>
      <div className="kitchen-slip-items">
        {selected.lines.map((row,index)=>{
          const previous=selected.lines[index-1];
          const currentGroup=kitchenCategoryLabel(row.category);
          const showGroup=!previous||kitchenCategoryLabel(previous.category)!==currentGroup;
          return <div key={row.id} className="kitchen-slip-item">
            {showGroup&&<strong className="kitchen-slip-category">{currentGroup}</strong>}
            <div className="kitchen-slip-name">{row.quantity}× {row.name}</div>
            <div className="kitchen-slip-note">
              {row.serviceMode==="TAKEAWAY"?"PARA LLEVAR"
                :row.serviceMode==="DINE_IN"?"AQUÍ":"SERVICIO SIN DEFINIR"}
            </div>
            {row.note&&<div className="kitchen-slip-note">NOTA: {row.note}</div>}
          </div>;
        })}
      </div>
      {slip.orderNote&&<p className="kitchen-slip-general-note">MESA: {slip.orderNote}</p>}
      <footer><p className="kitchen-slip-folio">{slip.folio}</p></footer>
    </article>
  </main>;
}
