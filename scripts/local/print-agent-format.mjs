/**
 * Render alternativo SOLO QA: líneas ESC/POS desde Node, sin Canvas ni
 * navegador. Mantiene folio, rondas, notas, importes, pagos, puntos y cliente.
 * No sustituye el formato raster/comercial hasta verificar en POS-58.
 */
export function sanitized(value,limit=180){
 return String(value??"").replace(/[\x00-\x1f\x7f]/g," ").replace(/\s+/g," ").trim().slice(0,limit);
}
export function wrapped(value,width=32){
 const words=sanitized(value,450).split(" ").filter(Boolean);
 const out=[];let current="";
 for(const word of words){
   if(word.length>width){
     if(current){out.push(current);current="";}
     for(let n=0;n<word.length;n+=width)out.push(word.slice(n,n+width));
     continue;
   }
   if((current?current.length+1:0)+word.length>width){
     out.push(current);current=word;
   }else{current=current?current+" "+word:word;}
 }
 if(current)out.push(current);
 return out.length?out:[""];
}
const line=(text,{align="left",bold=false,size="normal"}={})=>({
 text:sanitized(text),align,bold,size,
});
const rows=(text,width,opts)=>wrapped(text,width).map(s=>line(s,opts));
/** El puente 1.3.0 admite un logo rasterizado y texto ESC/POS
 * en el mismo trabajo. Mantiene acentos CP850 y evita una 2a llamada física.
 */
function printableLogo(template){
 if(template.showLogo!==true)return null;
 const {logoRasterBase64:data,logoWidthPx:width,logoHeightPx:height}=template;
 if(typeof data!=="string"||!Number.isInteger(width)||!Number.isInteger(height)||
    width<1||width>384||height<1||height>800)return null;
 const expected=Math.ceil(width/8)*height;
 if(data.length>expected*2||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))return null;
 if(Buffer.from(data,"base64").length!==expected)return null;
 return {dataBase64:data,width,height,
   align:["left","right","center"].includes(template.logoAlign)
     ?template.logoAlign:"center"};
}
export function printAgentPayload(job,template={},now=new Date()){
 if(!job||typeof job!=="object"||!["KITCHEN","VOID","RECEIPT","PREBILL"].includes(job.kind))
   throw Error("Trabajo de impresión inválido.");
 const maxWidth=Math.max(24,Math.min(42,Number(template.lineWidthChars)||32));
 const lines=[];
 const add=(value,opts={})=>lines.push(...rows(value,maxWidth,opts));
 const divider=()=>lines.push(line("-".repeat(maxWidth)));
 if(["KITCHEN","VOID"].includes(job.kind)){
   const slip=job.slip;
   if(!slip||!Array.isArray(slip.lines)||!slip.lines.length)
     throw Error("Comanda sin líneas");
   add(job.kind==="VOID"?"ANULACION DE BARRA":"COMANDA DE BARRA",
     {bold:true,align:"center",size:"double"});
   add(slip.table||slip.folio||"SIN MESA",
     {bold:true,align:"center",size:"double"});
   if(slip.customerName)add("CLIENTE: "+slip.customerName,{bold:true,align:"center"});
   add(new Intl.DateTimeFormat("es-MX",{timeZone:"America/Mexico_City",
     hour:"2-digit",minute:"2-digit",hour12:false}).format(now),{align:"center"});
   divider();
   for(const item of slip.lines){
     add((item.quantity??1)+" x "+(item.name??""),{bold:true});
     add(item.serviceMode==="TAKEAWAY"?"  PARA LLEVAR":"  AQUI",{bold:true});
     if(item.note)add("NOTA: "+item.note,{bold:true});
   }
   if(slip.orderNote){divider();add("NOTA MESA: "+slip.orderNote,{bold:true});}
   divider();add("Ref: "+sanitized(slip.folio).slice(-8),{align:"center"});
   return {lines,feed:2,cut:false};
 }
 const ticket=job.ticket;
 if(!ticket||!Array.isArray(ticket.items))throw Error("Ticket sin productos.");
 if(template.showBusinessName!==false)
   add(template.businessName||"Café Épico",{align:"center",bold:true,size:"double"});
 if(template.showAddress!==false&&template.addressLine)
   add(template.addressLine,{align:"center"});
 add(job.kind==="PREBILL"?"PRECUENTA - SIN LIQUIDAR":"TICKET DE VENTA",
   {align:"center",bold:true});
 if(ticket.splitLabel)add(ticket.splitLabel,{bold:true,align:"center"});
 divider();
 if(template.showFolio!==false)add("Folio: "+ticket.folio);
 if(template.showDate!==false)add("Fecha: "+ticket.date);
 if(template.showEmployee!==false)add("Atendio: "+ticket.employee);
 if(template.showService!==false)add("Servicio: "+ticket.service);
 divider();
 for(const item of ticket.items){
   add((item.quantity??1)+" x "+item.name,{bold:true});
   if(item.extra)add(" + "+item.extra);
   if(template.showItemNotes!==false&&item.note)add(" * "+item.note);
   add(item.total,{bold:true,align:"right"});
 }
 divider();
 add("TOTAL: "+ticket.total,{bold:true,size:"double"});
 if(job.kind==="PREBILL"){
   if(ticket.paidAmount)add("Abonado: "+ticket.paidAmount);
   add("Por pagar: "+(ticket.outstanding||ticket.total),{bold:true});
 }else{
   add("Pago: "+(ticket.payment||"Sin cargo"));
   if(ticket.cashTendered)add("Recibido: "+ticket.cashTendered);
   if(ticket.cashChange)add("Cambio: "+ticket.cashChange,{bold:true});
 }
 if(template.showCustomer!==false&&ticket.customer)add("Cliente: "+ticket.customer);
 if(template.showPoints!==false){
   if(ticket.pointsRedeemed)add("Puntos usados: "+ticket.pointsRedeemed);
   if(ticket.monetaryPaid)add("Dinero real: "+ticket.monetaryPaid);
   if(ticket.pointsEarned)add("Puntos ganados: "+ticket.pointsEarned);
   if(ticket.pointsBalance)add("Saldo puntos: "+ticket.pointsBalance);
 }
 if(ticket.status==="CANCELLED")add("CANCELADO - SIN VALIDEZ",{bold:true});
 divider();
 if(job.kind!=="PREBILL"&&template.footerMessage)add(template.footerMessage,{align:"center"});
 if(template.showNoCfdi!==false)add("Este ticket no es CFDI.",{align:"center"});
 if(lines.length>240)throw Error("Impresión excesiva: revisión manual");
 return {lines,feed:Math.max(1,Math.min(8,Number(template.feedLines)||3)),
   cut:Boolean(template.autoCut),logo:printableLogo(template)};
}
