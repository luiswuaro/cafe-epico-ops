import {eq} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {inventoryItems,itemCostHistory,loyverseInventoryMappings} from "@/src/infrastructure/db/schema";
import {costOnlyComponentCode,WATER_COST_PER_G_MXN,ICE_COST_PER_G_MXN} from "@/src/application/pos/component-policy";

type Component=Record<string,unknown>;
type Price={value:number;effectiveAt:number;source:string};
type Item={id:string;name:string;unit:"g"|"ml"|"pz";prices:Price[]};
type Legacy={id:string;factor:number;unit:string};
const numeric=(v:unknown):number|null=>{
 if(v===null||v===undefined||v==="")return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;
};
const normalize=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .toLocaleUpperCase("es-MX").replace(/\s+/g," ").trim();
function units(raw:unknown):"g"|"ml"|"pz"|"kg"|"L"|"peso/volumen"|null{
 const s=String(raw??"").trim().toLowerCase();
 if(s==="g"||s==="gramo"||s==="gramos")return "g";
 if(s==="ml"||s==="mililitro"||s==="mililitros")return "ml";
 if(s==="pz"||s==="pieza"||s==="piezas")return "pz";
 if(s==="kg")return "kg";
 if(s==="l"||s==="litro"||s==="litros")return "L";
 if(s==="peso/volumen")return "peso/volumen";
 return null;
}
function canonicalQuantity(q:number,unit:ReturnType<typeof units>,target:Item["unit"]){
 if(unit===target)return q;
 if(unit==="kg"&&target==="g")return q*1000;
 if(unit==="L"&&target==="ml")return q*1000;
 // Sólo en el formato histórico Loyverse; requiere ítem con unidad inequívoca.
 if(unit==="peso/volumen"&&(target==="g"||target==="ml"))return q*1000;
 return null;
}
export type LineCostResult={
 known:number;complete:boolean;reconstructed:boolean;total:number;priced:number;
 missing:string[];
};
/** Los importes son la mejor reconstrucción disponible cuando las ventas son
 * anteriores al alta inicial de costos; NO equivale al costo histórico comprobado.
 * Nunca usar una actualización posterior para revaluar retrospectivamente.
 */
export async function getPosCostResolver(organizationId:string){
 const db=getDb();
 const [items,history,mappings]=await Promise.all([
  db.select({id:inventoryItems.id,name:inventoryItems.name,
    unit:inventoryItems.canonicalUnit}).from(inventoryItems)
    .where(eq(inventoryItems.organizationId,organizationId)),
  db.select({id:itemCostHistory.inventoryItemId,
    cost:itemCostHistory.costPerCanonicalUnit,at:itemCostHistory.effectiveFrom,
    source:itemCostHistory.source})
    .from(itemCostHistory).where(eq(itemCostHistory.organizationId,organizationId)),
  db.select({variantId:loyverseInventoryMappings.loyverseVariantExternalId,
    itemId:loyverseInventoryMappings.inventoryItemId,
    factor:loyverseInventoryMappings.factorToCanonical,
    sourceUnit:loyverseInventoryMappings.sourceUnit,
    active:loyverseInventoryMappings.isActive}).from(loyverseInventoryMappings)
    .where(eq(loyverseInventoryMappings.organizationId,organizationId)),
 ]);
 const byId=new Map<string,Item>(),byName=new Map<string,Item|null>();
 for(const i of items){
  const item:Item={id:i.id,name:i.name,unit:i.unit,prices:[]};
  byId.set(item.id,item);
  const key=normalize(item.name);
  if(byName.has(key))byName.set(key,null); // nombre ambiguo: no adivinar
  else byName.set(key,item);
 }
 for(const h of history){
  const item=byId.get(h.id),cost=numeric(h.cost);
  if(!item||cost===null)continue;
  item.prices.push({value:cost,effectiveAt:h.at.getTime(),source:h.source});
 }
 for(const item of byId.values())item.prices.sort((a,b)=>a.effectiveAt-b.effectiveAt);
 const byVariant=new Map<string,Legacy|null>();
 for(const mapping of mappings){
  if(!mapping.active)continue;
  const factor=numeric(mapping.factor);
  if(!factor||!byId.has(mapping.itemId))continue;
  const prev=byVariant.get(mapping.variantId);
  const next:Legacy={id:mapping.itemId,factor,unit:mapping.sourceUnit};
  if(prev===undefined)byVariant.set(mapping.variantId,next);
  else if(prev&& (prev.id!==next.id||prev.factor!==next.factor))
    byVariant.set(mapping.variantId,null); // mapeos en disputa
 }
 function rate(item:Item,paidAt:Date){
  const at=paidAt.getTime();
  const prior=item.prices.filter(p=>p.effectiveAt<=at).at(-1);
  if(prior)return {...prior,reconstructed:false};
  const first=item.prices[0];
  if(first&&(first.source.startsWith("LOYVERSE_INITIAL_")||
     first.source.startsWith("OWNER_ICEE_INITIAL_EST_")))
    return {...first,reconstructed:true};
  return null;
 }
 function calculateComponent(comp:Component,paidAt:Date){
  const label=String(comp.name??"").trim();
  const quantity=numeric(comp.quantity);
  if(quantity===null)return {cost:null,reason:label+" · cantidad inválida",reconstructed:false};
  const special=costOnlyComponentCode({
    name:label,
    inventoryItemId:typeof comp.inventoryItemId==="string"?comp.inventoryItemId:null,
    inventoryLocationId:typeof comp.inventoryLocationId==="string"?comp.inventoryLocationId:null,
    variantExternalId:typeof comp.variantExternalId==="string"?comp.variantExternalId:null,
    itemExternalId:typeof comp.itemExternalId==="string"?comp.itemExternalId:null,
    costOnlyCode:comp.costOnlyCode==="WATER"?"WATER":comp.costOnlyCode==="ICE"?"ICE":null,
    unitLabel:String(comp.unitLabel??""),
  });
  if(special==="ICE"){
    const unit=units(comp.unitLabel);
    const grams=unit==="kg"||unit==="peso/volumen"?quantity*1000:unit==="g"?quantity:null;
    return grams===null?
      {cost:null,reason:"HIELO · unidad no compatible",reconstructed:false}:
      {cost:grams*ICE_COST_PER_G_MXN,reason:null,reconstructed:true};
  }
  if(special==="WATER"){
   const measure=comp.costOnlyMeasure as Record<string,unknown>|undefined;
   const stored=numeric(measure?.estimatedCostMxn);
   if(stored!==null)return {cost:stored,reason:null,reconstructed:false};
   const qty=units(comp.unitLabel)==="kg"||units(comp.unitLabel)==="peso/volumen"
     ?quantity*1000:quantity;
   return {cost:qty*WATER_COST_PER_G_MXN,reason:null,reconstructed:true};
  }
  const nativeId=typeof comp.inventoryItemId==="string"?comp.inventoryItemId:null;
  const variantId=typeof comp.variantExternalId==="string"?comp.variantExternalId:null;
  const byNative=nativeId?byId.get(nativeId):undefined;
  const mapping=!nativeId&&variantId?byVariant.get(variantId):undefined;
  // No sustituir un ID explícito que no resuelve por un ingrediente con nombre parecido.
  if(nativeId&&!byNative)return {cost:null,reason:label+" · vínculo OPS no encontrado",reconstructed:false};
  if(variantId&&!nativeId&&!mapping)
   return {cost:null,reason:label+" · equivalencia de Loyverse no encontrada",reconstructed:false};
  const candidate=byNative||(mapping?byId.get(mapping.id):undefined)||
    (!nativeId&&!variantId?byName.get(normalize(label)):undefined);
  if(!candidate)return {cost:null,reason:label+" · sin equivalencia única de costo",reconstructed:false};
  const sourceUnit=units(comp.unitLabel);
  // Los snapshots nuevos guardan g/ml/pz; las recetas viejas pueden traer
  // kg/L o "peso/volumen". Nunca multiplicar por 1000 dos veces.
  const amount=canonicalQuantity(quantity,sourceUnit,candidate.unit);
  if(amount===null)return {cost:null,reason:label+" · unidad incompatible ("+String(comp.unitLabel??"")+")",reconstructed:false};
  const selected=rate(candidate,paidAt);
  if(!selected)return {cost:null,reason:label+" · sin precio de compra en OPS",reconstructed:false};
  return {cost:amount*selected.value,reason:null,
    reconstructed:selected.reconstructed||!nativeId};
 }
 return (expected:unknown,paidAt:Date):LineCostResult=>{
  const snapshot=expected&&typeof expected==="object"&&!Array.isArray(expected)?
    expected as Record<string,unknown>:{};
  const components=Array.isArray(snapshot.components)?snapshot.components:[];
  const missing:string[]=[];
  let sum=0,priced=0,reconstructed=false;
  for(const part of components){
   if(!part||typeof part!=="object"||Array.isArray(part)){missing.push("Componente inválido");continue;}
   const result=calculateComponent(part as Component,paidAt);
   if(result.cost===null)missing.push(result.reason??"Costo pendiente");
   else {sum+=result.cost;priced++;reconstructed||=result.reconstructed;}
  }
  if(!components.length)missing.push("Receta sin componentes");
  return {known:Math.round(sum*10000)/10000,
    complete:components.length>0&&priced===components.length,
    reconstructed,total:components.length,priced,missing};
 };
}
