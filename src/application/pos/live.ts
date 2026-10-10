import { and, eq, sql } from "drizzle-orm";
import { getPosCatalog, type PosServiceMode } from "@/src/application/pos/catalog";
import {priceExtras, readExtraSnapshots, type ExtraRequest} from "@/src/application/pos/extras";
import {getPosExtraCatalog} from "@/src/application/pos/extra-catalog";
import {OWN_CONTAINER_DISCOUNT_MXN,canUseOwnContainer,isOwnContainerDisposable,
  isOwnContainerSnapshot,ownContainerUnitPrice,preparedOwnContainerComponents} from "@/src/domain/pos/own-container";
import {dailyTakeawayTicketLabel,effectiveOrderServiceMode,validateTicketLabel} from "@/src/application/pos/ticket-names";
import { isCostOnlyComponent, costOnlyRecipeMeasure } from "@/src/application/pos/component-policy";
import { getDb } from "@/src/infrastructure/db/client";
import {calculateEarnedPointsFromRealMoney} from "@/src/domain/pos/benefits-preview";
import {
  auditEvents, inventoryBalances, inventoryItems, inventoryMovements,
  loyverseInventoryMappings, posCashMovements, posCashSessions, posCustomers,
  posLoyaltyEntries, posOrderLines, posOrders, posPayments, posOrderSplits, posOrderSplitLines,
} from "@/src/infrastructure/db/schema";

export type LiveCart = Array<{
  externalId: string;
  quantity: number;
  note: string | null;
  serviceMode?:PosServiceMode;
  customerContainer?:boolean;
  extras?:ExtraRequest[];
  // ID interno de la línea congelada de una comanda guardada; jamás se toma de una petición del navegador.
  sourceLineId?:string;
}>;

export function isPosLiveEnabled() {
  return process.env.POS_LIVE_ENABLED === "true";
}

function businessDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(date);
}
function mapKey(locationId:string,itemId:string) {
  return locationId + ":" + itemId;
}

export async function checkoutLiveOrder(input:{
  organizationId:string;
  storeId:string;
  employeeId:string;
  actorUserId:string;
  clientOrderId:string;
  existingOrderId?:string;
  existingSplitId?:string;
  cart:LiveCart;
  customerId:string|null;
  serviceMode:PosServiceMode;
  paymentMethod:"CASH"|"CARD"|"TRANSFER"|"POINTS";
  redeemPoints?:number;
  tenderedAmount:number|null;
  tableLabel:string|null;
  note:string|null;
  allowStockShortage?:boolean;
}) {
  if(!isPosLiveEnabled()) throw new Error("Cobros LIVE deshabilitados por seguridad.");
  if(input.cart.length===0 || input.cart.length>30) throw new Error("Carrito inválido.");
  const db=getDb();
  // La cotización y la receta se congelan cuando el ticket se guarda.
  // Preleer sólo para preparar el carrito; dentro de la transacción se valida
  // otra vez, bajo el bloqueo de la comanda, antes de aplicar dinero e inventario.
  const stored=input.existingOrderId
    ?await db.select().from(posOrderLines).where(and(
      eq(posOrderLines.orderId,input.existingOrderId),
      eq(posOrderLines.organizationId,input.organizationId),
    ))
    :[];
  const byStoredId=new Map(stored.map(line=>[line.id,line]));
  const catalog=await getPosCatalog(input.organizationId,{includeDisabled:Boolean(input.existingOrderId)});
  const extrasCatalog=await getPosExtraCatalog(input.organizationId);
  const products=new Map(catalog.map(item=>[item.id,item]));
  const lines=input.cart.map(line=>{
    const item=products.get(line.externalId);
    const snapshot=input.existingOrderId && line.sourceLineId
      ?byStoredId.get(line.sourceLineId):undefined;
    if(!item || (!item.active&&!snapshot) || line.quantity<1 ||
       !Number.isInteger(line.quantity) || line.quantity>20){
      throw new Error("Producto no disponible para la venta.");
    }
    if(input.existingOrderId && (!snapshot || snapshot.catalogExternalId!==line.externalId ||
      (snapshot.note??null)!==(line.note??null) || line.quantity>Number(snapshot.quantity)))
      throw new Error("La línea del ticket guardado cambió. Vuelve a abrir la comanda.");
    // En pruebas LIVE, limitar el menú a un producto explícitamente aprobado.
    // El control se valida en servidor: no depende de filtros en el navegador.
    const pilotProduct = process.env.POS_LIVE_PILOT_ITEM?.trim();
    if(pilotProduct && item.name.toLocaleUpperCase("es-MX") !== pilotProduct.toLocaleUpperCase("es-MX")){
      throw new Error("Piloto LIVE limitado a "+pilotProduct+". No se cobró otro producto.");
    }
    const lineMode=line.serviceMode??input.serviceMode;
    const customerContainer=snapshot
      ?isOwnContainerSnapshot(snapshot.expectedConsumption)
      :line.customerContainer===true;
    if(customerContainer&&!canUseOwnContainer(item,lineMode))
      throw new Error("Termo propio sólo aplica a bebidas para llevar.");
    if(snapshot && line.customerContainer!==undefined &&
      line.customerContainer!==customerContainer)
      throw new Error("El estado de termo propio de la comanda cambió.");
    if(snapshot && snapshot.expectedConsumption?.serviceMode!==lineMode)
      throw new Error("El servicio de la línea guardada no coincide.");
    const resolvedExtras=snapshot
      ?{unitPrice:0,extras:readExtraSnapshots(snapshot.expectedConsumption),components:[]}
      :priceExtras(line.extras,item,extrasCatalog);
    const frozen= snapshot?.expectedConsumption?.components;
    const snapshotQuantity=snapshot?Number(snapshot.quantity):0;
    const recipeComponents=snapshot
      ?(Array.isArray(frozen)?frozen.map((value:unknown)=>{
          const comp=value as Record<string,unknown>;
          return {
            variantExternalId:typeof comp.variantExternalId==="string"?comp.variantExternalId:null,
            itemExternalId:typeof comp.itemExternalId==="string"?comp.itemExternalId:null,
            name:typeof comp.name==="string"?comp.name:"",
            unitLabel:typeof comp.unitLabel==="string"?comp.unitLabel:"pz",
            category:typeof comp.category==="string"?comp.category:null,
            quantity:Number(comp.quantity)/snapshotQuantity,
          };
        }):[])
      :preparedOwnContainerComponents(
        [...item.serviceRecipes[lineMode].components,...resolvedExtras.components],
        customerContainer,
      );
    if(recipeComponents.length===0 || recipeComponents.some(c=>!c.name||
      !Number.isFinite(c.quantity)||c.quantity<=0)){
      throw new Error("La receta original de "+item.name+" no está disponible para cobro.");
    }
    if(item.category==="CALIENTES" || item.category==="FRÍAS"){
      const names=recipeComponents.map(c=>c.name.toLocaleUpperCase("es-MX"));
      const hasCup=names.some(name=>/VASO/.test(name));
      const hasLid=names.some(name=>/TAPA/.test(name));
      const hasStraw=names.some(name=>/POPOTE|PAJILLA/.test(name));
      if(customerContainer && recipeComponents.some(isOwnContainerDisposable)){
         throw new Error("Termo propio no debe descontar vasos, tapas ni desechables.");
       }
       if(lineMode==="TAKEAWAY" && !customerContainer && (!hasCup || !hasLid)){
        throw new Error("Receta de "+item.name+" para llevar incompleta: falta vaso o tapa.");
      }
      if(lineMode==="DINE_IN" && names.some(name=>/VASO|TAPA|MANGA|FAJILLA|SERVILLETA/.test(name))){
        throw new Error("Receta de "+item.name+" para consumir aquí incluye desechables: revisa la receta.");
      }
      if(lineMode==="DINE_IN" && item.category==="FRÍAS" && !hasStraw){
        throw new Error("Receta fría de "+item.name+" para consumir aquí no incluye popote.");
      }
    }
    const price=snapshot?Number(snapshot.unitPrice):
      ownContainerUnitPrice(item.price,resolvedExtras.unitPrice,customerContainer);
    if(!Number.isFinite(price)||price<=0)
      throw new Error("Precio guardado no válido.");
    return {
      ...line,item,lineMode,customerContainer,price,extraSnapshots:resolvedExtras.extras,
      total:Number((price*line.quantity).toFixed(2)),
      components:recipeComponents.map(c=>({
        ...c,quantity:Number((c.quantity*line.quantity).toFixed(6)),
      })),
    };
  });
  const actualMode=effectiveOrderServiceMode(input.serviceMode,lines.map(line=>({serviceMode:line.lineMode})));
  if(!input.existingOrderId && actualMode!==input.serviceMode)
    throw new Error("El tipo de servicio cambió. Actualiza el pedido antes de cobrar.");
  if(!input.existingOrderId)validateTicketLabel(actualMode,input.tableLabel);
  const total=Number(lines.reduce((sum,line)=>sum+line.total,0).toFixed(2));
  if(total<=0) throw new Error("El total de la venta es inválido.");
  const requestedPoints=input.redeemPoints??0;
  if(!Number.isFinite(requestedPoints)||requestedPoints<0 ||
    !Number.isInteger(Math.round(requestedPoints*100)) ||
    Math.abs(requestedPoints*100-Math.round(requestedPoints*100))>0.000001 ||
    requestedPoints>total)throw new Error("Cantidad de puntos inválida para esta cuenta.");
  const redeemedAmount=Math.round(requestedPoints*100)/100; // 1 punto = $1 MXN
  if(redeemedAmount>0&&!input.customerId)throw new Error("Selecciona al cliente antes de canjear.");
  const monetaryDue=Math.round((total-redeemedAmount)*100)/100;
  if((monetaryDue===0)!==(input.paymentMethod==="POINTS"))
    throw new Error("Selecciona la forma de pago correspondiente al saldo restante.");
  if(input.paymentMethod==="CASH" &&
    (input.tenderedAmount===null || !Number.isFinite(input.tenderedAmount) ||
      input.tenderedAmount < monetaryDue || input.tenderedAmount > 1000000)) {
    throw new Error("El efectivo entregado debe cubrir el importe restante tras el canje.");
  }
  const now=new Date();
  const result=await db.transaction(async tx=>{
    // Serializar cobros de una sucursal: validación de caja, inventario y cliente es atómica.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.storeId}))`);
    let assignedLabel=input.tableLabel?.trim()||null;
    if(!input.existingOrderId && !assignedLabel && actualMode==="TAKEAWAY"){
      const [daily]=await tx.select({count:sql<number>`count(*)::int`})
        .from(posOrders).where(and(
          eq(posOrders.organizationId,input.organizationId),
          eq(posOrders.storeId,input.storeId),
          eq(posOrders.businessDate,businessDate(now)),
        ));
      assignedLabel=dailyTakeawayTicketLabel(Number(daily?.count??0)+1);
    }
    // Si la comanda existe, se liquida sobre el MISMO folio.
    // El bloqueo protege contra cobros dobles desde distintos dispositivos.
    let pending:typeof posOrders.$inferSelect|undefined;
    let split:typeof posOrderSplits.$inferSelect|undefined;
    let finalSplitPayment=false;
    if(input.existingOrderId){
      [pending]=await tx.select().from(posOrders).where(and(
        eq(posOrders.id,input.existingOrderId),
        eq(posOrders.organizationId,input.organizationId),
        eq(posOrders.storeId,input.storeId),
      )).for("update").limit(1);
      if(!pending || pending.mode!=="LIVE" || pending.clientOrderId!==input.clientOrderId)
        throw new Error("Comanda LIVE no encontrada.");
      if(pending.status==="PAID") {
        if(input.existingSplitId) {
          const [paid]=await tx.select().from(posOrderSplits).where(and(
            eq(posOrderSplits.id,input.existingSplitId),eq(posOrderSplits.orderId,pending.id)
          )).limit(1);
          if(paid?.status==="PAID")return {id:pending.id,alreadyRecorded:true};
        }
        throw new Error("La comanda ya fue cobrada.");
      }
      if(!["SENT","PREPARING","READY","PARTIALLY_PAID"].includes(pending.status))
        throw new Error("Esta comanda ya no está abierta para cobro.");
      if(pending.status==="PARTIALLY_PAID"&&!input.existingSplitId)
        throw new Error("Hay cuentas parcialmente cobradas: termina las cuentas divididas.");
      if(pending.serviceMode!==input.serviceMode ||
        (pending.tableLabel||null)!==(input.tableLabel||null))
        throw new Error("Los datos de la comanda cambiaron. Actualiza Comandas.");
      const allSplits=await tx.select().from(posOrderSplits)
        .where(eq(posOrderSplits.orderId,pending.id)).for("update");
      if(input.existingSplitId){
        split=allSplits.find(x=>x.id===input.existingSplitId);
        if(!split)throw new Error("Cuenta dividida no encontrada.");
        if(split.status==="PAID")return {id:pending.id,alreadyRecorded:true};
        if(split.status!=="OPEN")throw new Error("La cuenta ya no puede cobrarse.");
        const assigned=await tx.select({
          lineId:posOrderSplitLines.orderLineId,
          quantity:posOrderSplitLines.quantity
        }).from(posOrderSplitLines).where(eq(posOrderSplitLines.splitId,split.id));
        if(!assigned.length)throw new Error("Cuenta sin productos asignados.");
        finalSplitPayment=allSplits.every(x=>x.id===split!.id||x.status==="PAID");
        const assignedMap=new Map(assigned.map(x=>[x.lineId,Number(x.quantity)]));
        const assignment=await tx.select().from(posOrderLines)
          .where(eq(posOrderLines.orderId,pending.id));
        const expected=assignment.filter(x=>assignedMap.has(x.id)).map(x=>({
          sourceLineId:x.id,
          catalogExternalId:x.catalogExternalId,
          quantity:assignedMap.get(x.id)!,note:x.note,price:Number(x.unitPrice),
          serviceMode: typeof x.expectedConsumption?.serviceMode==="string"
            ? x.expectedConsumption.serviceMode : pending!.serviceMode
        }));
        const expectedTotal=expected.reduce((sum,line)=>sum+line.quantity*line.price,0);
        if(Math.abs(expectedTotal-Number(split.total))>0.005||Math.abs(expectedTotal-total)>0.005)
          throw new Error("El total de esta cuenta no coincide con los productos asignados.");
        const signature=(values:Array<{sourceLineId?:string;catalogExternalId:string;quantity:number;note:string|null;price:number;serviceMode:string}>)=>
          values.map(v=>[v.sourceLineId??"",v.catalogExternalId,v.quantity,v.note||"",v.price.toFixed(2),v.serviceMode].join("|"))
            .sort().join("::");
        const checkout=signature(lines.map(l=>({
          sourceLineId:l.sourceLineId,catalogExternalId:l.item.id,quantity:l.quantity,note:l.note,price:l.price,serviceMode:l.lineMode
        })));
        if(checkout!==signature(expected))throw new Error("La cuenta cambió desde que se abrió.");
      } else if(allSplits.length){
        throw new Error("La mesa tiene cuentas divididas: cobra cada cuenta por separado.");
      }
      const savedLines=await tx.select().from(posOrderLines)
        .where(eq(posOrderLines.orderId,pending.id));
      const signature=(values:Array<{sourceLineId?:string;catalogExternalId:string;quantity:number;note:string|null;price:number;serviceMode:string}>)=>
        values.map(v=>[v.catalogExternalId,v.quantity,v.note||"",v.price.toFixed(2),v.serviceMode].join("|"))
          .sort().join("::");
      const snapshot=signature(savedLines.map(l=>({
        sourceLineId:l.id,catalogExternalId:l.catalogExternalId,
        quantity:Number(l.quantity),note:l.note,price:Number(l.unitPrice),
        serviceMode: typeof l.expectedConsumption?.serviceMode==="string"
          ? l.expectedConsumption.serviceMode : pending!.serviceMode,
      })));
      const checkout=signature(lines.map(l=>({
        sourceLineId:l.sourceLineId,catalogExternalId:l.item.id,quantity:l.quantity,note:l.note,price:l.price,
        serviceMode:l.lineMode,
      })));
      if(!split&&(snapshot!==checkout || Number(pending.total)!==total))
        throw new Error("La comanda cambió de precio, producto o cantidad. No se ha cobrado; solicita revisión.");
    } else {
      const [duplicate]=await tx.select({id:posOrders.id}).from(posOrders).where(and(
        eq(posOrders.organizationId,input.organizationId),
        eq(posOrders.clientOrderId,input.clientOrderId),
      )).limit(1);
      if(duplicate) return {id:duplicate.id,alreadyRecorded:true};
    }

    const [session]=await tx.select().from(posCashSessions).where(and(
      eq(posCashSessions.organizationId,input.organizationId),
      eq(posCashSessions.storeId,input.storeId),
      eq(posCashSessions.status,"OPEN"),
    )).for("update").limit(1);
    if(!session) throw new Error("Abre una caja operativa antes de cobrar.");
    
    if(split && pending && pending.customerId!==input.customerId)
      throw new Error("Para dividir la cuenta, usa el cliente registrado en la mesa.");
    if(input.customerId){
      const [customer]=await tx.select({id:posCustomers.id,pointsBalance:posCustomers.pointsBalance})
        .from(posCustomers).where(and(
          eq(posCustomers.id,input.customerId),
          eq(posCustomers.organizationId,input.organizationId),
          eq(posCustomers.isActive,true),
        )).for("update").limit(1);
      if(!customer) throw new Error("Cliente no válido.");
      if(redeemedAmount>Number(customer.pointsBalance))
        throw new Error("Saldo de puntos insuficiente; actualiza la cuenta.");
    }

    const mappings=await tx.select({
      externalId:loyverseInventoryMappings.loyverseVariantExternalId,
      locationId:loyverseInventoryMappings.locationId,
      inventoryItemId:loyverseInventoryMappings.inventoryItemId,
      factor:loyverseInventoryMappings.factorToCanonical,
      unit:inventoryItems.canonicalUnit,
      itemName:inventoryItems.name,
    }).from(loyverseInventoryMappings)
      .innerJoin(inventoryItems,eq(inventoryItems.id,loyverseInventoryMappings.inventoryItemId))
      .where(and(
        eq(loyverseInventoryMappings.organizationId,input.organizationId),
        eq(loyverseInventoryMappings.storeId,input.storeId),
        eq(loyverseInventoryMappings.isActive,true),
        eq(inventoryItems.isActive,true),
      ));
    const byExternal=new Map(mappings.map(mapping=>[mapping.externalId,mapping]));
    const consume=new Map<string,{locationId:string;itemId:string;itemName:string;amount:number;unit:string;names:Set<string>}>();
    let costOnlyComponents = 0;
    for(const line of lines){
      for(const component of line.components){
        if(isCostOnlyComponent(component)){
          costOnlyComponents++;
          continue;
        }
        const map=component.variantExternalId ? byExternal.get(component.variantExternalId) : undefined;
        if(!map) throw new Error("Insumo sin equivalencia confirmada: "+component.name+" ("+line.item.name+").");
        const factor=Number(map.factor);
        const amount=Math.round(component.quantity*factor*1000)/1000;
        if(!(amount>0) || !Number.isFinite(amount)){
          throw new Error("Unidad o cantidad no válida en "+component.name);
        }
        const key=mapKey(map.locationId,map.inventoryItemId);
        const existing=consume.get(key);
        if(existing){
          existing.amount=Math.round((existing.amount+amount)*1000)/1000;
          existing.names.add(line.item.name);
        } else {
          consume.set(key,{locationId:map.locationId,itemId:map.inventoryItemId,itemName:map.itemName,unit:map.unit,
            amount,names:new Set([line.item.name])});
        }
      }
    }

    const stocks=await tx.select().from(inventoryBalances).where(and(
      eq(inventoryBalances.organizationId,input.organizationId),
      eq(inventoryBalances.storeId,input.storeId),
    )).for("update");
    const byStock=new Map(stocks.map(stock=>[mapKey(stock.locationId,stock.inventoryItemId),stock]));
    const stockShortages:Array<{ingredient:string;available:number;required:number;deficit:number;unit:string;products:string[]}>=[];
    for(const [key,requested] of consume){
      const stock=byStock.get(key);
      if(!stock)throw new Error("Falta confirmar el saldo inicial de "+requested.itemName+
        " utilizado en "+[...requested.names].join(", "));
      const available=Number(stock.theoreticalQuantity);
      if(available+0.000001<requested.amount){
        const deficit=Math.round((requested.amount-available)*1000)/1000;
        stockShortages.push({
          ingredient:requested.itemName,available,required:requested.amount,deficit,
          unit:requested.unit,products:[...requested.names],
        });
      }
    }
    if(stockShortages.length&&!input.allowStockShortage){
      const x=stockShortages[0];
      throw new Error("Falta "+x.ingredient+": hay "+x.available+" "+x.unit+
        ", se requieren "+x.required+" "+x.unit+" (faltan "+x.deficit+" "+x.unit+
        "). Corrige el conteo físico o solicita autorización del propietario para registrar el faltante.");
    }

    const [order]=pending
      ? await tx.update(posOrders).set({
          status:split&&!finalSplitPayment?"PARTIALLY_PAID":"PAID",
          paidAt:split&&!finalSplitPayment?null:now,updatedAt:now,
          inventoryEffectApplied:true,
          customerId:input.customerId,
          loyaltyPointsPreview:(input.customerId?calculateEarnedPointsFromRealMoney(monetaryDue):0).toFixed(2),
          loyaltyEffectApplied:Boolean(input.customerId)||pending.loyaltyEffectApplied,
        }).where(and(eq(posOrders.id,pending.id),eq(posOrders.status,pending.status)))
          .returning({id:posOrders.id,folio:posOrders.folio})
      : await tx.insert(posOrders).values({
          organizationId:input.organizationId,storeId:input.storeId,
          employeeId:input.employeeId,clientOrderId:input.clientOrderId,
          folio:"OP-"+now.toISOString().replace(/[-:TZ.]/g,"").slice(0,14)+"-"+input.clientOrderId.slice(-5).toUpperCase(),
          mode:"LIVE",status:"PAID",serviceMode:input.serviceMode,
          // El nombre identifica también los pedidos para llevar y mixtos.
          tableLabel:assignedLabel,
          customerId:input.customerId,businessDate:businessDate(now),
          subtotal:total.toFixed(2),total:total.toFixed(2),note:input.note,
          loyaltyPointsPreview:(input.customerId?calculateEarnedPointsFromRealMoney(monetaryDue):0).toFixed(2),
          loyaltyEffectApplied:Boolean(input.customerId),inventoryEffectApplied:true,paidAt:now,
        }).returning({id:posOrders.id,folio:posOrders.folio});
    if(!order) throw new Error("Comanda modificada durante el cobro.");
    if(!pending) await tx.insert(posOrderLines).values(lines.map(line=>({
      organizationId:input.organizationId,orderId:order.id,
      catalogExternalId:line.item.id,variantExternalId:line.item.variantExternalId,
      nameSnapshot:line.item.name,categorySnapshot:line.item.category,
      unitPrice:line.price.toFixed(2),quantity:String(line.quantity),lineTotal:line.total.toFixed(2),
      note:line.note,expectedConsumption:{
        mode:"LIVE",serviceMode:line.lineMode,extras:line.extraSnapshots,
        customerContainer:line.customerContainer,
        discount:line.customerContainer?{
          code:"OWN_THERMOS",amountPerUnit:OWN_CONTAINER_DISCOUNT_MXN,
          total:Number((OWN_CONTAINER_DISCOUNT_MXN*line.quantity).toFixed(2)),
        }:null,
        components:line.components.map(component => ({
          ...component,
          inventoryPolicy:isCostOnlyComponent(component) ? "COST_ONLY" : "TRACKED",
          costOnlyMeasure:costOnlyRecipeMeasure(component, component.quantity),
        })),
      },
    })));
    if(split){
      const [changed]=await tx.update(posOrderSplits).set({
        status:"PAID",paidAt:now,updatedAt:now
      }).where(and(eq(posOrderSplits.id,split.id),eq(posOrderSplits.status,"OPEN")))
        .returning({id:posOrderSplits.id});
      if(!changed)throw new Error("Esta cuenta fue cobrada por otro dispositivo.");
    }
    // La cuenta conserva su valor total. Puntos son una forma de liquidación
    // no monetaria: no ingresan a caja y no generan puntos nuevos.
    if(redeemedAmount>0){
      await tx.insert(posPayments).values({
        organizationId:input.organizationId,orderId:order.id,
        splitId:split?.id??null,method:"POINTS",amount:redeemedAmount.toFixed(2),
        reference:"CANJE_1_PUNTO_1_MXN",
      });
      const [debited]=await tx.update(posCustomers).set({
        pointsBalance:sql`${posCustomers.pointsBalance} - ${redeemedAmount}`,updatedAt:now,
      }).where(and(eq(posCustomers.id,input.customerId!),
        eq(posCustomers.organizationId,input.organizationId),
        sql`${posCustomers.pointsBalance} >= ${redeemedAmount}`
      )).returning({id:posCustomers.id});
      if(!debited)throw new Error("El cliente ya no tiene suficientes puntos.");
      await tx.insert(posLoyaltyEntries).values({
        organizationId:input.organizationId,customerId:input.customerId!,
        orderId:order.id,entryType:"REDEEM",points:(-redeemedAmount).toFixed(2),
        note:(split?.label??"Cuenta")+" · Canje 1pt=$1 · "+order.folio,
      });
    }
    if(monetaryDue>0){
      await tx.insert(posPayments).values({
        organizationId:input.organizationId,orderId:order.id,
        splitId:split?.id??null,method:input.paymentMethod,
        amount:monetaryDue.toFixed(2),
        tenderedAmount:input.paymentMethod==="CASH" ? input.tenderedAmount!.toFixed(2) : null,
        changeAmount:input.paymentMethod==="CASH" ? (input.tenderedAmount!-monetaryDue).toFixed(2) : null,
      });
      if(input.paymentMethod==="CASH")await tx.insert(posCashMovements).values({
        organizationId:input.organizationId,storeId:input.storeId,
        sessionId:session.id,orderId:order.id,splitId:split?.id??null,employeeId:input.employeeId,
        movementType:"SALE",amount:monetaryDue.toFixed(2),note:order.folio,
      });
    }

    for(const item of consume.values()){
      await tx.insert(inventoryMovements).values({
        organizationId:input.organizationId,storeId:input.storeId,
        locationId:item.locationId,inventoryItemId:item.itemId,
        movementType:"SALE",quantityDelta:(-item.amount).toFixed(3),
        sourceType:"POS_LIVE_ORDER",sourceId:order.id,occurredAt:now,
        employeeId:input.employeeId,note:order.folio,
        externalProvider:"OPS_POS",externalId:split?.id??order.id,
      });
      await tx.update(inventoryBalances).set({
        theoreticalQuantity:sql`${inventoryBalances.theoreticalQuantity} - ${item.amount}`,
        updatedAt:now,
      }).where(and(
        eq(inventoryBalances.storeId,input.storeId),
        eq(inventoryBalances.locationId,item.locationId),
        eq(inventoryBalances.inventoryItemId,item.itemId),
      ));
    }

    if(input.customerId){
      const earned=calculateEarnedPointsFromRealMoney(monetaryDue);
      if(earned>0){
        await tx.update(posCustomers).set({
          pointsBalance:sql`${posCustomers.pointsBalance} + ${earned}`,
          updatedAt:now,
        }).where(and(eq(posCustomers.id,input.customerId),eq(posCustomers.organizationId,input.organizationId)));
        await tx.insert(posLoyaltyEntries).values({
          organizationId:input.organizationId,customerId:input.customerId,
          orderId:order.id,entryType:"EARN",points:earned.toFixed(2),note:(split?.label??"Compra")+" · "+order.folio,
        });
      }
    }
    if(stockShortages.length){
      await tx.insert(auditEvents).values({
        organizationId:input.organizationId,storeId:input.storeId,
        actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
        action:"POS_LIVE_INVENTORY_SHORTAGE_AUTHORIZED",
        entityType:"pos_order",entityId:order.id,
        afterData:{folio:order.folio,shortages:stockShortages,
          reason:"Producto físicamente entregado; ajuste de existencia pendiente",
          requiresPhysicalCount:true},
      });
    }
    await tx.insert(auditEvents).values({
      organizationId:input.organizationId,storeId:input.storeId,
      actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
      action:split?"POS_LIVE_SPLIT_PAID":pending?"POS_LIVE_COMMAND_PAID":"POS_LIVE_SALE_PAID",entityType:"pos_order",entityId:order.id,
      afterData:{folio:order.folio,total,redeemedPoints:redeemedAmount,monetaryPaid:monetaryDue,
        pointsEarned:input.customerId?calculateEarnedPointsFromRealMoney(monetaryDue):0,
        payment:input.paymentMethod,fromOpenCommand:Boolean(pending),
        splitId:split?.id??null,finalPayment:!split||finalSplitPayment,consumptionCount:consume.size,costOnlyComponents,
        customerId:input.customerId,inventoryEffectApplied:true,loyaltyEffectApplied:Boolean(input.customerId),
        stockShortageOverride:stockShortages.length>0},
    });
    return {id:order.id,alreadyRecorded:false};
  });
  return result;
}
