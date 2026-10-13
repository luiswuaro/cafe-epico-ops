import { and, eq, sql } from "drizzle-orm";
import {assertNoPreviewMutation} from "@/src/shared/preview-guard";
import {calculatePaperBagPlan,incrementalPaperBags,isPaperBagInventoryItem,isFourCupCarrierInventoryItem,validateFreeCupCarriers,type PackagingLine} from "@/src/domain/pos/paper-bag-packaging";
import { getPosCatalog, type PosServiceMode } from "@/src/application/pos/catalog";
import {priceExtras, readExtraSnapshots, type ExtraRequest} from "@/src/application/pos/extras";
import {getPosExtraCatalog} from "@/src/application/pos/extra-catalog";
import {OWN_CONTAINER_DISCOUNT_MXN,canUseOwnContainer,isOwnContainerDisposable,
  isOwnContainerSnapshot,ownContainerUnitPrice,preparedOwnContainerComponents} from "@/src/domain/pos/own-container";
import {dailyTakeawayTicketLabel,effectiveOrderServiceMode,validateTicketLabel} from "@/src/application/pos/ticket-names";
import { isCostOnlyComponent, costOnlyRecipeMeasure } from "@/src/application/pos/component-policy";
import { takeawayPackagingErrors } from "@/src/domain/pos/takeaway-packaging";
import {resolveUnlinkedOpsIngredient} from "@/src/domain/pos/resolve-unlinked-ops-ingredient";
import { getDb } from "@/src/infrastructure/db/client";
import {calculateEarnedPointsFromRealMoney} from "@/src/domain/pos/benefits-preview";
import {
  auditEvents, employees, inventoryBalances, inventoryItems, inventoryLocations, inventoryMovements,
  loyverseInventoryMappings, posCashMovements, posCashSessions, posCustomers,
  posLoyaltyEntries, posOrderLines, posOrders, posPayments, posOrderSplits, posOrderSplitLines, posStaffDrinks,
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

function savedLinesHaveTakeawayDrink(rows:Array<{
 expected:Record<string,unknown>;category:string;
}>){
 return rows.some(row=>row.category!=="ALIMENTOS"&&
   row.expected?.serviceMode==="TAKEAWAY");
}

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
  paymentMethod:"CASH"|"CARD"|"TRANSFER"|"POINTS"|"STAFF_BENEFIT";
  /** UUID del trabajador al que corresponde la bebida de cortesía (solo una por día). */
  staffFreeEmployeeId?:string|null;
  redeemPoints?:number;
  tenderedAmount:number|null;
  tableLabel:string|null;
  note:string|null;
  allowStockShortage?:boolean;
  courtesyCupCarriers4?:number;
}) {
  assertNoPreviewMutation();
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
            inventoryItemId:typeof comp.inventoryItemId==="string"?comp.inventoryItemId:null,
            inventoryLocationId:typeof comp.inventoryLocationId==="string"?comp.inventoryLocationId:null,
            costOnlyCode:comp.costOnlyCode==="WATER"?"WATER" as const:comp.costOnlyCode==="ICE"?"ICE" as const:null,
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
      const hasStraw=names.some(name=>/POPOTE|PAJILLA/.test(name));
      if(customerContainer && recipeComponents.some(isOwnContainerDisposable)){
         throw new Error("Termo propio no debe descontar vasos, tapas ni desechables.");
       }
       if(lineMode==="TAKEAWAY" && !customerContainer){
        const packagingErrors=takeawayPackagingErrors(item,recipeComponents);
        if(packagingErrors.length)
          throw new Error("Receta de "+item.name+" para llevar incompleta: "+packagingErrors.join(" "));
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
  const staffFree=Boolean(input.staffFreeEmployeeId);
  let staffListedPrice=0;
  if(staffFree){
    // Sólo una bebida base para consumir aquí. Jamás interpretar esta cortesía como puntos.
    if(input.existingOrderId || lines.length!==1 || lines[0].quantity!==1 ||
      lines[0].item.category==="ALIMENTOS" || lines[0].lineMode!=="DINE_IN" ||
      lines[0].customerContainer || (input.cart[0].extras?.length??0)>0 ||
      lines[0].extraSnapshots.length>0 || input.customerId || (input.redeemPoints??0)!==0)
      throw new Error("La bebida gratuita es una bebida base, para consumir aquí, en ticket individual y sin cliente ni extras.");
    staffListedPrice=lines[0].price;
    lines[0].price=0;
    lines[0].total=0;
  }
  const actualMode=effectiveOrderServiceMode(input.serviceMode,lines.map(line=>({serviceMode:line.lineMode})));
  if(!input.existingOrderId && actualMode!==input.serviceMode)
    throw new Error("El tipo de servicio cambió. Actualiza el pedido antes de cobrar.");
  if(!input.existingOrderId)validateTicketLabel(actualMode,input.tableLabel);
  const total=Number(lines.reduce((sum,line)=>sum+line.total,0).toFixed(2));
  if(total<=0&&!staffFree) throw new Error("El total de la venta es inválido.");
  const requestedPoints=input.redeemPoints??0;
  if(!Number.isFinite(requestedPoints)||requestedPoints<0 ||
    !Number.isInteger(Math.round(requestedPoints*100)) ||
    Math.abs(requestedPoints*100-Math.round(requestedPoints*100))>0.000001 ||
    requestedPoints>total)throw new Error("Cantidad de puntos inválida para esta cuenta.");
  const redeemedAmount=Math.round(requestedPoints*100)/100; // 1 punto = $1 MXN
  if(redeemedAmount>0&&!input.customerId)throw new Error("Selecciona al cliente antes de canjear.");
  const monetaryDue=Math.round((total-redeemedAmount)*100)/100;
  if(staffFree){
    if(monetaryDue!==0 || input.paymentMethod!=="STAFF_BENEFIT")
      throw new Error("Una cortesía de personal no se registra como cobro ni como canje de puntos.");
  }else if(input.paymentMethod==="STAFF_BENEFIT" ||
    (monetaryDue===0)!==(input.paymentMethod==="POINTS")){
    throw new Error("Selecciona la forma de pago correspondiente al saldo restante.");
  }
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
    if(!session) throw new Error("Abre una caja operativa antes de registrar el ticket.");

    if(staffFree){
      const [beneficiary]=await tx.select({id:employees.id,homeStoreId:employees.homeStoreId})
        .from(employees).where(and(
          eq(employees.id,input.staffFreeEmployeeId!),
          eq(employees.organizationId,input.organizationId),
          eq(employees.isActive,true),
        )).limit(1);
      if(!beneficiary || (beneficiary.homeStoreId && beneficiary.homeStoreId!==input.storeId))
        throw new Error("Selecciona un trabajador activo de esta sucursal.");
      const [alreadyUsed]=await tx.select({id:posStaffDrinks.id})
        .from(posStaffDrinks).where(and(
          eq(posStaffDrinks.organizationId,input.organizationId),
          eq(posStaffDrinks.beneficiaryEmployeeId,beneficiary.id),
          eq(posStaffDrinks.businessDate,businessDate(now)),
        )).limit(1);
      if(alreadyUsed)
        throw new Error("Este trabajador ya registró su bebida gratuita de hoy. Las siguientes bebidas se cobran normalmente.");
    }
    
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
    const [nativeItems,locations]=await Promise.all([
      tx.select({
        id:inventoryItems.id,name:inventoryItems.name,
        unit:inventoryItems.canonicalUnit,trackingType:inventoryItems.trackingType,
      }).from(inventoryItems).where(and(
        eq(inventoryItems.organizationId,input.organizationId),
        eq(inventoryItems.isActive,true),
      )),
      tx.select({id:inventoryLocations.id,name:inventoryLocations.name}).from(inventoryLocations).where(and(
        eq(inventoryLocations.organizationId,input.organizationId),
        eq(inventoryLocations.storeId,input.storeId),
        eq(inventoryLocations.isActive,true),
      )),
    ]);
    const nativeById=new Map(nativeItems.map(item=>[item.id,item]));
    const allowedLocations=new Set(locations.map(loc=>loc.id));
    // Lock all balances before auto-resolving frozen ingredient identities.
    const stocks=await tx.select().from(inventoryBalances).where(and(
      eq(inventoryBalances.organizationId,input.organizationId),
      eq(inventoryBalances.storeId,input.storeId),
    )).for("update");
    const fallbackBalances=stocks.map(stock=>({
      inventoryItemId:stock.inventoryItemId,locationId:stock.locationId,
    }));
    const nativeAutoResolved:Array<{ingredient:string;inventoryItemId:string;locationId:string;amount:number}>=[];
    const consume=new Map<string,{locationId:string;itemId:string;itemName:string;amount:number;unit:string;names:Set<string>}>();
    let costOnlyComponents = 0;
    for(const line of lines){
      for(const component of line.components){
        if(isCostOnlyComponent(component)){
          costOnlyComponents++;
          continue;
        }
        const nativeId=component.inventoryItemId;
        const nativeLocation=component.inventoryLocationId;
        const native=nativeId?nativeById.get(nativeId):undefined;
        let mapped:{locationId:string;inventoryItemId:string;itemName:string;unit:string;factor:number};
        if(nativeId||nativeLocation){
          if(!native||!nativeLocation||!allowedLocations.has(nativeLocation))
            throw new Error("Insumo OPS sin ubicación válida: "+component.name);
          if(native.trackingType==="COST_ONLY"){costOnlyComponents++;continue;}
          if(native.trackingType!=="QUANTITY")
            throw new Error("Política de inventario no válida para "+native.name);
          if(component.unitLabel!==native.unit)
            throw new Error("Unidad nativa no coincide para "+native.name);
          mapped={locationId:nativeLocation,inventoryItemId:nativeId!,
            itemName:native.name,unit:native.unit,factor:1};
        }else{
          const old=component.variantExternalId?byExternal.get(component.variantExternalId):undefined;
          if(old){
            mapped={...old,factor:Number(old.factor)};
          }else{
            const physical=resolveUnlinkedOpsIngredient(component,nativeItems,locations,fallbackBalances);
            if(!physical)throw new Error("Insumo sin vinculación OPS: "+component.name+
              " ("+line.item.name+"). No hay coincidencia única de nombre y unidad en el inventario físico de la sucursal.");
            mapped={locationId:physical.locationId,
              inventoryItemId:physical.inventoryItemId,
              itemName:physical.itemName,unit:physical.unit,factor:physical.factor};
            nativeAutoResolved.push({ingredient:component.name,
              inventoryItemId:physical.inventoryItemId,locationId:physical.locationId,
              amount:Math.round(component.quantity*physical.factor*1000)/1000});
          }
        }
        const amount=Math.round(component.quantity*mapped.factor*1000)/1000;
        if(!(amount>0) || !Number.isFinite(amount)){
          throw new Error("Unidad o cantidad no válida en "+component.name);
        }
        const key=mapKey(mapped.locationId,mapped.inventoryItemId);
        const existing=consume.get(key);
        if(existing){
          existing.amount=Math.round((existing.amount+amount)*1000)/1000;
          existing.names.add(line.item.name);
        } else {
          consume.set(key,{locationId:mapped.locationId,itemId:mapped.inventoryItemId,itemName:mapped.itemName,unit:mapped.unit,
            amount,names:new Set([line.item.name])});
        }
      }
    }

    // Empaque a nivel de ticket: las bolsas de hojaldra se comparten entre piezas.
    // En cuentas divididas descontar sólo bolsas adicionales respecto a cuentas ya pagadas.
    const packagingNow:PackagingLine[]=lines.map(line=>({
      name:line.item.name,category:line.item.category,
      serviceMode:line.lineMode,quantity:line.quantity,
    }));
    let previousPackaging:PackagingLine[]=[];
    if(split&&pending){
      const alreadyPaid=await tx.select({
        name:posOrderLines.nameSnapshot,category:posOrderLines.categorySnapshot,
        qty:posOrderSplitLines.quantity,expected:posOrderLines.expectedConsumption,
      }).from(posOrderSplitLines)
        .innerJoin(posOrderSplits,eq(posOrderSplits.id,posOrderSplitLines.splitId))
        .innerJoin(posOrderLines,eq(posOrderLines.id,posOrderSplitLines.orderLineId))
        .where(and(eq(posOrderSplits.orderId,pending.id),eq(posOrderSplits.status,"PAID")));
      previousPackaging=alreadyPaid.map(row=>({
        name:row.name,category:row.category,quantity:Number(row.qty),
        serviceMode:row.expected?.serviceMode==="TAKEAWAY"?"TAKEAWAY":"DINE_IN",
      }));
    }
    const paperBags=split
      ?incrementalPaperBags(previousPackaging,packagingNow)
      :calculatePaperBagPlan(packagingNow).bags;
    let packagingWarning:string|null=null;
    if(paperBags>0){
      const bagCandidates=nativeItems.filter(isPaperBagInventoryItem);
      const barLocations=locations.filter(loc=>loc.name.normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g,"").toUpperCase().trim()==="BARRA");
      if(bagCandidates.length===1&&barLocations.length===1){
        const bag=bagCandidates[0],loc=barLocations[0],key=mapKey(loc.id,bag.id);
        const existing=consume.get(key);
        if(existing){
          existing.amount+=paperBags;
          existing.names.add("EMPAQUE DE ALIMENTOS");
        }else consume.set(key,{locationId:loc.id,itemId:bag.id,
          itemName:bag.name,amount:paperBags,unit:"pz",names:new Set(["EMPAQUE DE ALIMENTOS"])});
      }else packagingWarning="Configura un único insumo activo BOLSA PAPEL (pz) en Barra. El empaque físico no se descontó.";
    }

    // Cortesía por ticket, registrada explícitamente antes de guardar o cobrar.
    // Las comandas guardadas conservan la decisión en expectedConsumption:
    // no aceptar una cantidad nueva desde un formulario de cobro posterior.
    let courtesyCupCarriers4=0;
    if(pending){
      const storedCarriers=await tx.select({
        expected:posOrderLines.expectedConsumption,
        category:posOrderLines.categorySnapshot,
      }).from(posOrderLines).where(eq(posOrderLines.orderId,pending.id));
      const storedQuantity=storedCarriers.reduce((sum,row)=>{
        const raw=row.expected?.courtesyCupCarriers4;
        return sum+(typeof raw==="number"?raw:0);
      },0);
      courtesyCupCarriers4=validateFreeCupCarriers(storedQuantity,
        savedLinesHaveTakeawayDrink(storedCarriers));
      // Las charolas son por ticket, no por división del dinero.
      if(split){
        const paid=await tx.select({id:posOrderSplits.id}).from(posOrderSplits)
          .where(and(eq(posOrderSplits.orderId,pending.id),eq(posOrderSplits.status,"PAID"))).limit(1);
        if(paid.length)courtesyCupCarriers4=0;
      }
    }else{
      courtesyCupCarriers4=validateFreeCupCarriers(input.courtesyCupCarriers4??0,
        lines.some(line=>line.lineMode==="TAKEAWAY"&&line.item.category!=="ALIMENTOS"));
    }
    let cupCarrierWarning:string|null=null;
    if(courtesyCupCarriers4>0){
      const candidates=nativeItems.filter(isFourCupCarrierInventoryItem);
      const bar=locations.filter(location=>location.name.normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g,"").toUpperCase().trim()==="BARRA");
      if(candidates.length===1&&bar.length===1){
        const item=candidates[0],loc=bar[0],key=mapKey(loc.id,item.id);
        const previous=consume.get(key);
        if(previous){
          previous.amount+=courtesyCupCarriers4;
          previous.names.add("PORTAVASOS CORTESÍA");
        }else consume.set(key,{
          locationId:loc.id,itemId:item.id,itemName:item.name,amount:courtesyCupCarriers4,
          unit:"pz",names:new Set(["PORTAVASOS CORTESÍA"]),
        });
      }else cupCarrierWarning="Dar de alta un único PORTAVASOS 4 (pz) en Barra. Cortesía registrada, inventario pendiente.";
    }

    const byStock=new Map(stocks.map(stock=>[mapKey(stock.locationId,stock.inventoryItemId),stock]));
    const stockShortages:Array<{ingredient:string;available:number;required:number;deficit:number;unit:string;products:string[]}>=[];
    for(const [key,requested] of consume){
      const stock=byStock.get(key);
      // Un saldo teórico sin existencia o sin conteo inicial jamás frena el cobro.
      const available=stock?Number(stock.theoreticalQuantity):0;
      if(available+0.000001<requested.amount){
        const deficit=Math.round((requested.amount-available)*1000)/1000;
        stockShortages.push({
          ingredient:requested.itemName,available,required:requested.amount,deficit,
          unit:requested.unit,products:[...requested.names],
        });
      }
    }
    // Saldos negativos permitidos para todos los operadores; rastreo obligatorio.
    // No se relajan las validaciones de receta, unidad, insumo ni ubicación.

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
          subtotal:(staffFree?staffListedPrice:total).toFixed(2),total:total.toFixed(2),note:input.note,
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
        courtesyCupCarriers4:lines.indexOf(line)===0?(input.courtesyCupCarriers4??0):0,
        customerContainer:line.customerContainer,
        discount:staffFree?{
          code:"STAFF_INCLUDED_DRINK",amountPerUnit:staffListedPrice,
          total:staffListedPrice,beneficiaryEmployeeId:input.staffFreeEmployeeId,
          note:"Cortesía interna sin ingreso, sin puntos y con consumo de insumos",
        }:line.customerContainer?{
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
    if(staffFree){
      // La restricción UNIQUE diaria protege incluso frente a envíos simultáneos.
      // La cancelación posterior no libera la cortesía automáticamente.
      await tx.insert(posStaffDrinks).values({
        organizationId:input.organizationId,storeId:input.storeId,
        beneficiaryEmployeeId:input.staffFreeEmployeeId!,
        businessDate:businessDate(now),orderId:order.id,
        listedPrice:staffListedPrice.toFixed(2),
        recordedByEmployeeId:input.employeeId,
      });
    }
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
      // Si nunca hubo conteo inicial, iniciar en cero de forma idempotente.
      if(!byStock.has(mapKey(item.locationId,item.itemId))){
        await tx.insert(inventoryBalances).values({
          organizationId:input.organizationId,storeId:input.storeId,
          locationId:item.locationId,inventoryItemId:item.itemId,
          theoreticalQuantity:"0",
        }).onConflictDoNothing();
      }
      await tx.insert(inventoryMovements).values({
        organizationId:input.organizationId,storeId:input.storeId,
        locationId:item.locationId,inventoryItemId:item.itemId,
        movementType:staffFree?"MANUAL_ADJUSTMENT":"SALE",quantityDelta:(-item.amount).toFixed(3),
        sourceType:"POS_LIVE_ORDER",sourceId:order.id,occurredAt:now,
        employeeId:input.employeeId,note:staffFree
          ?"Consumo interno · bebida incluida · "+order.folio:order.folio,
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
    if(paperBags>0){
      await tx.insert(auditEvents).values({
        organizationId:input.organizationId,storeId:input.storeId,
        actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
        action:packagingWarning?"POS_PAPER_BAG_PENDING_SETUP":"POS_PAPER_BAG_CONSUMED",
        entityType:"pos_order",entityId:order.id,
        afterData:{folio:order.folio,bags:paperBags,
          policy:"HOJALDRA_3_CROISSANT_JAMON_1",
          splitId:split?.id??null,warning:packagingWarning},
      });
    }
    if(courtesyCupCarriers4>0){
      await tx.insert(auditEvents).values({
        organizationId:input.organizationId,storeId:input.storeId,
        actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
        action:cupCarrierWarning?"POS_COURTESY_CARRIER_PENDING_SETUP":"POS_COURTESY_CARRIER_CONSUMED",
        entityType:"pos_order",entityId:order.id,
        afterData:{folio:order.folio,quantity:courtesyCupCarriers4,capacity:4,
          amountCharged:0,splitId:split?.id??null,warning:cupCarrierWarning},
      });
    }
    if(stockShortages.length){
      await tx.insert(auditEvents).values({
        organizationId:input.organizationId,storeId:input.storeId,
        actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
        action:"POS_LIVE_INVENTORY_SHORTAGE_AUTO_RECORDED",
        entityType:"pos_order",entityId:order.id,
        afterData:{folio:order.folio,shortages:stockShortages,
          reason:"Venta permitida sin bloqueo por falta de saldo teórico",
          requiresPhysicalCount:true,automaticForAllOperators:true},
      });
    }
    await tx.insert(auditEvents).values({
      organizationId:input.organizationId,storeId:input.storeId,
      actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
      action:staffFree?"POS_STAFF_DRINK_RECORDED":
        split?"POS_LIVE_SPLIT_PAID":pending?"POS_LIVE_COMMAND_PAID":"POS_LIVE_SALE_PAID",
      entityType:"pos_order",entityId:order.id,
      afterData:{folio:order.folio,total,redeemedPoints:redeemedAmount,monetaryPaid:monetaryDue,
        pointsEarned:input.customerId?calculateEarnedPointsFromRealMoney(monetaryDue):0,
        payment:staffFree?"NONE":input.paymentMethod,
        staffBeneficiaryId:staffFree?input.staffFreeEmployeeId:null,
        staffBenefitDiscount:staffFree?staffListedPrice:0,
        internalConsumption:staffFree,fromOpenCommand:Boolean(pending),
        splitId:split?.id??null,finalPayment:!split||finalSplitPayment,consumptionCount:consume.size,costOnlyComponents,
        nativeAutoResolved,
        customerId:input.customerId,inventoryEffectApplied:true,loyaltyEffectApplied:Boolean(input.customerId),
        automaticStockShortage:stockShortages.length>0,paperBags,
        courtesyCupCarriers4,cupCarrierWarning,
        paperBagSetupWarning:packagingWarning},
    });
    return {id:order.id,alreadyRecorded:false};
  });
  return result;
}
