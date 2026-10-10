import {and,eq,sql} from "drizzle-orm";
import {getPosCatalog} from "./catalog";
import {getDb} from "@/src/infrastructure/db/client";
import {auditEvents,inventoryBalances,inventoryItems,inventoryMovements,loyverseInventoryMappings,posOrders,posOrderLines} from "@/src/infrastructure/db/schema";

export type ExtraPackInput={
  organizationId:string;storeId:string;orderId:string;lineId:string;
  actorUserId:string;employeeId:string;requestId:string;quantity:number;
};
const isPack=(name:string)=>/VASO|TAPA|MANGA|FAJILLA|POPOTE|PAJILLA|SERVILLETA|AGITADOR/i.test(name);
const componentId=(component:{variantExternalId:string|null;name:string})=>
  component.variantExternalId??component.name.toLocaleUpperCase("es-MX");
export async function recordExtraPackaging(input:ExtraPackInput){
  if(!Number.isInteger(input.quantity)||input.quantity<1||input.quantity>20)
    throw new Error("Cantidad de empaques inválida.");
  const catalog=await getPosCatalog(input.organizationId,{includeDisabled:true});
  const db=getDb();
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.storeId}))`);
    const [order]=await tx.select().from(posOrders).where(and(
      eq(posOrders.id,input.orderId),eq(posOrders.organizationId,input.organizationId),
      eq(posOrders.storeId,input.storeId),
    )).for("update").limit(1);
    if(!order||order.mode!=="LIVE"||order.status!=="PAID")
      throw new Error("El ticket debe estar totalmente pagado y activo.");
    const [line]=await tx.select().from(posOrderLines).where(and(
      eq(posOrderLines.id,input.lineId),eq(posOrderLines.orderId,order.id),
    )).limit(1);
    if(!line||line.expectedConsumption?.serviceMode!=="DINE_IN")
      throw new Error("La bebida debe haberse servido originalmente aquí.");
    const existing=await tx.select({requestId:auditEvents.requestId,data:auditEvents.afterData})
      .from(auditEvents).where(and(
        eq(auditEvents.organizationId,input.organizationId),
        eq(auditEvents.action,"POS_EXTRA_TAKEAWAY_PACKAGING"),
        eq(auditEvents.entityId,order.id),
      ));
    if(existing.some(e=>e.requestId===input.requestId))return;
    const used=existing.filter(e=>e.data?.lineId===line.id)
      .reduce((n,e)=>n+Number(e.data?.quantity??0),0);
    if(input.quantity+used>Number(line.quantity))
      throw new Error("Se agotaron los empaques extra permitidos para esta línea.");
    const item=catalog.find(p=>p.id===line.catalogExternalId);
    if(!item)throw new Error("Producto no disponible en el catálogo.");
    const here=new Map<string,number>();
    // Usar el consumo de empaques que quedó registrado al vender,
    // no la receta Aquí que pudo haberse modificado desde entonces.
    const original=line.expectedConsumption?.components;
    const orig=Array.isArray(original)?original:[];
    for(const raw of orig){
      if(!raw||typeof raw!=="object")continue;
      const c=raw as Record<string,unknown>;
      if(typeof c.name!=="string"||!isPack(c.name))continue;
      const component={
        name:c.name,
        variantExternalId:typeof c.variantExternalId==="string"?c.variantExternalId:null,
      };
      const amount=Number(c.quantity)/Number(line.quantity);
      if(Number.isFinite(amount)&&amount>0){
        const id=componentId(component);
        here.set(id,(here.get(id)??0)+amount);
      }
    }
    const extras=item.serviceRecipes.TAKEAWAY.components.filter(c=>isPack(c.name))
      .map(c=>({...c,quantity:Math.max(0,c.quantity-(here.get(componentId(c))??0))*input.quantity}))
      .filter(c=>c.quantity>0);
    if(!extras.some(c=>/VASO/i.test(c.name))||!extras.some(c=>/TAPA/i.test(c.name)))
      throw new Error("Falta vaso o tapa en la receta para llevar.");
    const mappings=await tx.select({
      ext:loyverseInventoryMappings.loyverseVariantExternalId,
      location:loyverseInventoryMappings.locationId,
      item:loyverseInventoryMappings.inventoryItemId,
      factor:loyverseInventoryMappings.factorToCanonical,
      name:inventoryItems.name,
    }).from(loyverseInventoryMappings)
      .innerJoin(inventoryItems,eq(inventoryItems.id,loyverseInventoryMappings.inventoryItemId))
      .where(and(eq(loyverseInventoryMappings.organizationId,input.organizationId),
        eq(loyverseInventoryMappings.storeId,input.storeId),
        eq(loyverseInventoryMappings.isActive,true),eq(inventoryItems.isActive,true)));
    const byExt=new Map(mappings.map(x=>[x.ext,x]));
    const consumed=new Map<string,{location:string;item:string;name:string;amount:number}>();
    for(const extra of extras){
      const m=extra.variantExternalId?byExt.get(extra.variantExternalId):null;
      if(!m)throw new Error("Sin mapeo de inventario: "+extra.name);
      const amount=Math.round(extra.quantity*Number(m.factor)*1000)/1000;
      if(amount<=0)throw new Error("Cantidad de inventario inválida.");
      const id=m.location+":"+m.item,old=consumed.get(id);
      if(old)old.amount+=amount;
      else consumed.set(id,{location:m.location,item:m.item,name:m.name,amount});
    }
    for(const c of consumed.values()){
      const [stock]=await tx.select().from(inventoryBalances).where(and(
        eq(inventoryBalances.storeId,input.storeId),
        eq(inventoryBalances.locationId,c.location),
        eq(inventoryBalances.inventoryItemId,c.item),
      )).for("update").limit(1);
      if(!stock||Number(stock.theoreticalQuantity)+.000001<c.amount)
        throw new Error("No alcanza el inventario de "+c.name+".");
    }
    const now=new Date();
    for(const c of consumed.values()){
      await tx.insert(inventoryMovements).values({
        organizationId:input.organizationId,storeId:input.storeId,
        locationId:c.location,inventoryItemId:c.item,
        movementType:"SALE",quantityDelta:(-c.amount).toFixed(3),
        sourceType:"POS_EXTRA_PACKAGING",sourceId:order.id,occurredAt:now,
        employeeId:input.employeeId,note:"Envase posterior · "+order.folio,
        externalProvider:"OPS_POS_PACK",externalId:input.requestId,
      });
      await tx.update(inventoryBalances).set({
        theoreticalQuantity:sql`${inventoryBalances.theoreticalQuantity} - ${c.amount}`,
        updatedAt:now,
      }).where(and(eq(inventoryBalances.storeId,input.storeId),
        eq(inventoryBalances.locationId,c.location),eq(inventoryBalances.inventoryItemId,c.item)));
    }
    await tx.insert(auditEvents).values({
      organizationId:input.organizationId,storeId:input.storeId,
      actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
      action:"POS_EXTRA_TAKEAWAY_PACKAGING",entityType:"pos_order",
      entityId:order.id,requestId:input.requestId,
      afterData:{lineId:line.id,quantity:input.quantity,
        components:[...consumed.values()].map(c=>({name:c.name,amount:c.amount}))},
    });
  });
}
