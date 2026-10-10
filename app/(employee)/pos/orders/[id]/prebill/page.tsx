import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getOrderSplitState } from "@/src/application/pos/splits";
import {extraLabels} from "@/src/application/pos/extras";
import { getPosPrintSettings } from "@/src/application/pos/print-settings";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { employees, posPayments } from "@/src/infrastructure/db/schema";
import { DirectPrintTicketButton } from "../../../receipt/[id]/direct-print-button";
import { PrintTicketButton } from "../../../receipt/[id]/print-button";

export const dynamic="force-dynamic";
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});

export default async function PrebillPage({params,searchParams}:{
  params:Promise<{id:string}>;
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}){
  const {id}=await params;
  const query=await searchParams;
  const requestedSplitId=typeof query.split==="string"?query.split:null;
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);

  // Sólo lectura: no se cobra, no se descuenta inventario y no se crea
  // ningún movimiento de caja por imprimir o reimprimir una precuenta.
  const [state,settings]=await Promise.all([
    getOrderSplitState(employee.organizationId,employee.homeStoreId,id),
    getPosPrintSettings(employee.organizationId),
  ]);
  if(!state||state.order.mode!=="LIVE")throw new Error("Comanda LIVE no encontrada");
  if(state.order.status==="CANCELLED")throw new Error("La comanda está cancelada");
  const split=requestedSplitId
    ?state.splits.find(row=>row.id===requestedSplitId)
    :null;
  if(requestedSplitId&&!split)throw new Error("Cuenta dividida no encontrada");
  if((split&&split.status==="PAID")||(!split&&state.order.status==="PAID")){
    redirect("/pos/receipt/"+id+(split?"?split="+split.id:""));
  }
  // Cada línea refleja los valores congelados en la comanda.
  const lines=split
    ?split.lines.map(assignment=>{
      const original=state.lines.find(line=>line.id===assignment.orderLineId);
      if(!original)throw new Error("Cuenta dividida inconsistente");
      return {id:assignment.id,name:original.nameSnapshot,
        quantity:Number(assignment.quantity),
        total:Number(assignment.lineTotal),note:original.note,
        extra:extraLabels(original.expectedConsumption,{showPrices:true}).join(" · ")||null,
        serviceMode:original.expectedConsumption?.serviceMode};
    })
    :state.lines.map(line=>({id:line.id,name:line.nameSnapshot,
      quantity:Number(line.quantity),total:Number(line.lineTotal),
      note:line.note,extra:extraLabels(line.expectedConsumption,{showPrices:true}).join(" · ")||null,
      serviceMode:line.expectedConsumption?.serviceMode}));
  const total=split?Number(split.total):Number(state.order.total);
  const db=getDb();
  const [staff]=state.order.employeeId
    ?await db.select({name:employees.name}).from(employees)
      .where(and(eq(employees.organizationId,employee.organizationId),
        eq(employees.id,state.order.employeeId))).limit(1)
    :[undefined];
  const payments=split?[]:await db.select({amount:posPayments.amount}).from(posPayments)
    .where(and(eq(posPayments.organizationId,employee.organizationId),
      eq(posPayments.orderId,id)));
  const paid=split?0:Math.min(total,payments.reduce((sum,p)=>sum+Number(p.amount),0));
  const remaining=Math.max(0,total-paid);
  const service=state.order.tableLabel||
    (state.order.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí");
  const generatedAt=new Date().toLocaleString("es-MX",{
    timeZone:"America/Mexico_City",dateStyle:"short",timeStyle:"short",
  });
  const back=split?"/pos/orders/"+id+"/split":"/pos/orders";
  const ticket={
    kind:"PREBILL" as const,folio:state.order.folio,
    status:state.order.status,date:generatedAt,
    employee:staff?.name??"Equipo",service,
    splitLabel:split?.label??null,
    items:lines.map(line=>({
      quantity:line.quantity,name:line.name,
      extra:line.extra,
      note:(line.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí")+
        (line.note?" · "+line.note:""),
      total:money.format(line.total),
    })),
    total:money.format(total),payment:"",
    paidAmount:paid>0?money.format(paid):undefined,
    outstanding:money.format(remaining),
  };
  const template={
    businessName:settings.businessName,addressLine:settings.addressLine,
    phoneLine:settings.phoneLine,socialLine:settings.socialLine,
    headerMessage:settings.headerMessage,footerMessage:settings.footerMessage,
    showLogo:settings.showLogo,logoRasterBase64:settings.logoRasterBase64,
    logoWidthPx:settings.logoWidthPx,logoHeightPx:settings.logoHeightPx,
    logoAlign:settings.logoAlign,
    showBusinessName:settings.showBusinessName,showAddress:settings.showAddress,
    showPhone:settings.showPhone,showSocial:settings.showSocial,
    showFolio:settings.showFolio,showDate:settings.showDate,
    showEmployee:settings.showEmployee,showService:settings.showService,
    showCustomer:false,showPoints:false,showItemNotes:settings.showItemNotes,
    showNoCfdi:settings.showNoCfdi,lineWidthChars:settings.lineWidthChars,
    feedLines:settings.feedLines,autoCut:settings.autoCut,
  };
  return <main className="receipt-shell">
    <div className="receipt-toolbar no-print">
      <Link href={back} className="button">Volver a {split?"cuentas":"comandas"}</Link>
      <DirectPrintTicketButton ticket={ticket} template={template} label="Imprimir precuenta ESC/POS"/>
      <PrintTicketButton/>
    </div>
    <section className="card no-print" role="status" style={{marginBottom:12}}>
      <strong>Precuenta {split?"individual":"de mesa"} · sin registrar pago</strong>
      <p className="muted">Puedes entregarla al cliente antes de cobrar. Imprimir no cambia caja, inventario, puntos ni estado de la comanda.</p>
    </section>
    <article className="receipt-paper">
      <header>
        {settings.showLogo&&settings.logoDataUrl&&settings.logoWidthPx&&settings.logoHeightPx&&
          <div className={"receipt-logo receipt-logo-"+settings.logoAlign}>
            <Image src={settings.logoDataUrl} alt="Logo Café Épico"
              width={settings.logoWidthPx} height={settings.logoHeightPx} unoptimized/>
          </div>}
        {settings.showBusinessName&&<h1>{settings.businessName}</h1>}
        {settings.showAddress&&settings.addressLine&&<p>{settings.addressLine}</p>}
        {settings.showPhone&&settings.phoneLine&&<p>{settings.phoneLine}</p>}
        {settings.showSocial&&settings.socialLine&&<p>{settings.socialLine}</p>}
        <p className="receipt-document-type">PRECUENTA · SIN LIQUIDAR</p>
        {split&&<p><strong>{split.label}</strong></p>}
      </header>
      <div className="receipt-meta">
        <span>Folio</span><span>{state.order.folio}</span>
        <span>Mesa</span><span>{service}</span>
        <span>Emitida</span><span>{generatedAt}</span>
        {staff&&<><span>Atendió</span><span>{staff.name}</span></>}
      </div>
      <div className="receipt-lines">
        {lines.map(line=><div className="receipt-product" key={line.id}>
          <div className="receipt-line">
            <span>{line.quantity}× {line.name}</span>
            <span>{money.format(line.total)}</span>
          </div>
          {line.extra&&<div className="receipt-line-note">↳ {line.extra}</div>}
          {settings.showItemNotes&&line.note&&
            <div className="receipt-line-note">↳ {line.note}</div>}
        </div>)}
      </div>
      <div className="receipt-total"><span>Consumo</span><strong>{money.format(total)}</strong></div>
      <div className="receipt-meta">
        {paid>0&&<><span>Abonado</span><span>{money.format(paid)}</span></>}
        <span><strong>Por pagar</strong></span><span><strong>{money.format(remaining)}</strong></span>
      </div>
      <footer>
        <p className="receipt-prebill-warning">NO ES COMPROBANTE DE PAGO</p>
        <p>El importe puede cambiar si se agregan más productos.</p>
        {settings.showNoCfdi&&<p>Este documento no es CFDI.</p>}
      </footer>
    </article>
  </main>;
}
