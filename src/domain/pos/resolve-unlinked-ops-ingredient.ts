/** Resolve legacy recipe ingredients against the single physical OPS inventory.
 * Used only when a frozen order component has no native OPS ID and no verified
 * legacy mapping. Never invent a location, merge ambiguous SKUs or units.
 */
export type PhysicalItem={id:string;name:string;unit:string;trackingType:string};
export type PhysicalLocation={id:string;name:string};
export type PhysicalBalance={inventoryItemId:string;locationId:string};
export type LegacyComponent={name:string;unitLabel:string;quantity:number};
export type ResolvedPhysicalItem={
 inventoryItemId:string;locationId:string;itemName:string;unit:string;factor:number;
 resolution:"OPS_NAME_EXACT";
};
const normalize=(name:string)=>name.normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toLocaleUpperCase("es-MX")
 .replace(/\s+/g," ").trim();

function unitFactor(unitLabel:string,target:string):number|null{
 const old=unitLabel.trim().toLowerCase();
 if(old===target.toLowerCase())return 1;
 if((old==="peso/volumen"||old==="kg")&&target==="g")return 1000;
 if((old==="peso/volumen"||old==="l")&&target==="ml")return 1000;
 if((old==="pieza"||old==="piezas"||old==="unidad"||old==="unidades")&&target==="pz")return 1;
 return null;
}
export function resolveUnlinkedOpsIngredient(
 component:LegacyComponent,items:PhysicalItem[],
 locations:PhysicalLocation[],balances:PhysicalBalance[],
):ResolvedPhysicalItem|null{
 if(!component.name||!Number.isFinite(component.quantity)||component.quantity<=0)
   return null;
 const key=normalize(component.name);
 // Never guess generic water/ice from a physical product such as mineral water.
 if(key==="AGUA"||key==="HIELO")return null;
 const activeLocations=new Set(locations.map(l=>l.id));
 const stockSet=new Set(balances.map(b=>b.locationId+":"+b.inventoryItemId));
 const candidates:Array<ResolvedPhysicalItem & {bar:boolean}>=[];
 for(const item of items){
   if(item.trackingType!=="QUANTITY"||normalize(item.name)!==key)continue;
   const factor=unitFactor(component.unitLabel,item.unit);
   if(factor===null)continue;
   for(const location of locations){
     if(!activeLocations.has(location.id)||!stockSet.has(location.id+":"+item.id))continue;
     candidates.push({inventoryItemId:item.id,locationId:location.id,
       itemName:item.name,unit:item.unit,factor,resolution:"OPS_NAME_EXACT",
       bar:normalize(location.name)==="BARRA"});
   }
 }
 if(!candidates.length)return null;
 const bar=candidates.filter(c=>c.bar);
 const pool=bar.length?bar:candidates;
 if(pool.length!==1)return null;
 const selected=pool[0];
 return {inventoryItemId:selected.inventoryItemId,locationId:selected.locationId,
   itemName:selected.itemName,unit:selected.unit,factor:selected.factor,
   resolution:"OPS_NAME_EXACT"};
}
